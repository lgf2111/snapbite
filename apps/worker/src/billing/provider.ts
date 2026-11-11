import {
  type AIProvider,
  type AnalyzeMealOptions,
  type AnalyzeTextOptions,
  type CoachOptions,
  PROVIDER_PRESETS,
  type ReviseMealInput,
  type ReviseMealOptions,
  createProvider,
  decryptSecret,
  isProviderId,
} from '@snapbite/core';
import type { SettingsRow } from '../db/schema.js';
import { createSettingsDb, getSettings, parsePreferences } from '../db/settings.js';
import {
  InsufficientCredits,
  addCredits,
  getAccount,
  getVerifiedEmail,
  overflowSpentToday,
} from './accounts.js';

/**
 * The single place that answers who pays for an AI call.
 *
 * A stored BYOK key is always preferred and costs nothing. When that key hits a
 * real quota wall (429, or 403 quotaExceeded — never a 5xx), one credit is spent
 * and the same call is retried once on our hosted Gemini key, capped at 20
 * overflow credits per UTC day. An account with no stored key spends one credit
 * per call on the hosted key. Anything else is a typed {@link QuotaExceeded}
 * that the routes turn into a readable message.
 *
 * Every provider attempt writes one `ai_usage` row, success or failure, so the
 * overflow path records both the failed BYOK call and the hosted retry.
 */

export const HOSTED_PROVIDER_ID = 'gemini';
/** Pinned on purpose: the hosted key's model must not follow a user setting. */
export const HOSTED_MODEL = 'gemini-3.6-flash';
export const DAILY_OVERFLOW_CAP = 20;

export interface ProviderChoice {
  apiKey: string;
  provider: string;
  model: string | null;
  baseUrl?: string | null;
  supportsDetail?: boolean;
}

/** Injectable provider factory so tests can supply a mock. */
export type ProviderFactory = (choice: ProviderChoice) => AIProvider;

export const defaultProviderFactory: ProviderFactory = ({
  apiKey,
  provider,
  model,
  baseUrl,
  supportsDetail,
}) =>
  createProvider({
    providerId: provider,
    apiKey,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(supportsDetail != null ? { supportsDetail } : {}),
  });

export interface ProviderRuntime {
  ENCRYPTION_KEY?: string;
  GEMINI_API_KEY?: string;
}

export interface ResolveProviderOptions {
  providerFactory?: ProviderFactory;
  /** Injectable clock for tests (UTC overflow day + usage timestamps). */
  now?: () => number;
}

export type QuotaExceededReason =
  | 'no-access'
  | 'no-credits'
  | 'overflow-disabled'
  | 'daily-cap'
  | 'hosted-unavailable';

const QUOTA_MESSAGES: Record<QuotaExceededReason, string> = {
  'no-access': 'Add your AI key in Settings first. Signing in also unlocks prepaid credits.',
  'no-credits':
    "Your AI key hit its limit and you're out of credits. Add credits in Settings, or use a working key.",
  'overflow-disabled': 'Your AI key hit its limit. Credit overflow is turned off in Settings.',
  'daily-cap':
    "Your AI key hit its limit. You've used today's 20-credit overflow cap — try again tomorrow.",
  'hosted-unavailable':
    "Hosted analysis isn't configured right now. Add your own AI key in Settings to keep analyzing.",
};

/**
 * A refusal the routes can show verbatim. `status` is 400 when the account has
 * no way to pay at all (no key, not signed in) and 402 when the signed-in
 * account simply needs more credits.
 */
export class QuotaExceeded extends Error {
  override readonly name = 'QuotaExceeded';
  readonly reason: QuotaExceededReason;
  readonly status: 400 | 402;
  readonly userMessage: string;

  constructor(reason: QuotaExceededReason) {
    super(QUOTA_MESSAGES[reason]);
    this.reason = reason;
    this.status = reason === 'no-access' ? 400 : 402;
    this.userMessage = QUOTA_MESSAGES[reason];
  }
}

/** A saved key could not be used (missing master key or undecryptable). */
export class ProviderSetupError extends Error {
  override readonly name = 'ProviderSetupError';
  readonly status = 500;
  readonly userMessage: string;

  constructor(message: string) {
    super(message);
    this.userMessage = message;
  }
}

/**
 * Strict quota-wall test for the cascade: 429 always counts; 403 only when the
 * body actually says quota. A 5xx, a 401 or a generic 403 is not a quota wall
 * and must never spend a credit.
 */
export function isQuotaWall(err: unknown): boolean {
  const e = err as { status?: number; message?: string; cause?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  if (e.status === 429) return true;
  if (e.status !== 403) return false;
  const raw = `${typeof e.cause === 'string' ? e.cause : ''} ${e.message ?? ''}`;
  return /quota|quotaexceeded|resource_exhausted|exceeded your current quota/i.test(raw);
}

/** The metered provider handed to routes. `notice` is set after an overflow. */
export interface MeteredProvider extends AIProvider {
  /** Who actually paid for the call, after any overflow. */
  readonly source: 'byok' | 'hosted';
  /** One line to show the user at the moment a credit was used, else null. */
  readonly notice: string | null;
}

interface ActiveProvider {
  provider: AIProvider;
  model: string;
  source: 'byok' | 'hosted';
}

interface UsageInput {
  userId: string;
  email: string | null;
  provider: string;
  model: string;
  latencyMs: number;
  ok: boolean;
  method: string;
  requestId: string;
  at: number;
}

async function recordUsage(db: D1Database, input: UsageInput): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO ai_usage
           (id, user_id, email, provider, model, tokens_in, tokens_out, cost_micros,
            latency_ms, ok, kind, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.userId,
        input.email,
        input.provider,
        input.model,
        input.latencyMs,
        input.ok ? 1 : 0,
        input.method,
        input.requestId,
        input.at,
      )
      .run();
  } catch {
    /* Metering must never lose an otherwise-successful meal. */
  }
}

function byokModel(row: SettingsRow): string {
  const model = row.aiModel?.trim();
  if (model) return model;
  if (isProviderId(row.aiProvider)) return PROVIDER_PRESETS[row.aiProvider].defaultModel;
  return 'gpt-4o-mini';
}

function choiceFromSettings(row: SettingsRow, apiKey: string): ProviderChoice {
  const choice: ProviderChoice = { apiKey, provider: row.aiProvider, model: row.aiModel };
  if (row.aiProvider === 'custom') {
    const custom = parsePreferences(row.preferencesJson).customProvider;
    if (custom?.baseUrl) {
      choice.baseUrl = custom.baseUrl;
      choice.supportsDetail = custom.supportsDetail ?? false;
    }
  }
  return choice;
}

export async function resolveProviderForUser(
  db: D1Database,
  env: ProviderRuntime,
  userId: string,
  opts: ResolveProviderOptions = {},
): Promise<MeteredProvider> {
  const factory = opts.providerFactory ?? defaultProviderFactory;
  const now = opts.now ?? Date.now;

  const row = await getSettings(createSettingsDb(db), userId);
  const email = await getVerifiedEmail(db, userId);
  const account = email ? await getAccount(db, email) : null;
  const hostedKey = env.GEMINI_API_KEY?.trim() || null;

  // 1) A stored key always wins and costs nothing.
  let active: ActiveProvider;
  if (row?.apiKeyCiphertext && row?.apiKeyIv) {
    if (!env.ENCRYPTION_KEY) {
      throw new ProviderSetupError('Server encryption key is missing; add your AI key again.');
    }
    let apiKey: string;
    try {
      apiKey = await decryptSecret(
        { ciphertext: row.apiKeyCiphertext, iv: row.apiKeyIv },
        env.ENCRYPTION_KEY,
      );
    } catch {
      throw new ProviderSetupError(
        'Could not decrypt your saved AI key; add it again in Settings.',
      );
    }
    active = {
      provider: factory(choiceFromSettings(row, apiKey)),
      model: byokModel(row),
      source: 'byok',
    };
  } else if (hostedKey && email && account && account.credits > 0) {
    // 2) No key, but a signed-in account with credits: our key, one per call.
    active = {
      provider: hostedProvider(hostedKey, factory),
      model: HOSTED_MODEL,
      source: 'hosted',
    };
  } else if (hostedKey && email) {
    // Signed in, hosted key configured, but no credits left.
    throw new QuotaExceeded('no-credits');
  } else {
    // Anonymous or no hosted key: the free keyless message, not a billing refusal.
    throw new QuotaExceeded('no-access');
  }

  let notice: string | null = null;

  const spendOne = async (reason: 'analysis' | 'overflow'): Promise<void> => {
    if (!email) throw new QuotaExceeded('no-access');
    try {
      await addCredits(db, email, -1, reason);
    } catch (err) {
      if (err instanceof InsufficientCredits) throw new QuotaExceeded('no-credits');
      throw err;
    }
  };

  const refundOne = async (): Promise<void> => {
    if (!email) return;
    try {
      await addCredits(db, email, 1, 'refund');
    } catch {
      /* A failed refund must not mask the provider error. */
    }
  };

  /**
   * Runs one provider attempt and records it. A quota wall on a BYOK call
   * switches to the hosted key once (spending one credit); every other failure
   * refunds anything charged and is rethrown.
   */
  const attempt = async <T>(
    method: string,
    fn: (provider: AIProvider) => Promise<T>,
    callId: string,
    charged: boolean,
    isRetry: boolean,
  ): Promise<T> => {
    const started = now();
    const provider = active.provider;
    try {
      const result = await fn(provider);
      await recordUsage(db, {
        userId,
        email,
        provider: provider.id,
        model: active.model,
        latencyMs: Math.max(0, now() - started),
        ok: true,
        method,
        requestId: callId,
        at: now(),
      });
      return result;
    } catch (err) {
      await recordUsage(db, {
        userId,
        email,
        provider: provider.id,
        model: active.model,
        latencyMs: Math.max(0, now() - started),
        ok: false,
        method,
        requestId: callId,
        at: now(),
      });

      if (!isRetry && active.source === 'byok' && isQuotaWall(err)) {
        await switchToHosted(err, hostedKey, email, account);
        return attempt(method, fn, callId, true, true);
      }
      if (charged) await refundOne();
      throw err;
    }
  };

  /**
   * A real quota wall on the user's key: apply the 20/day cap and the overflow
   * toggle, spend exactly one credit, and switch `active` to the hosted key.
   */
  const switchToHosted = async (
    original: unknown,
    key: string | null,
    address: string | null,
    billing: Awaited<ReturnType<typeof getAccount>>,
  ): Promise<void> => {
    // Not configured / nobody to bill: preserve the primary error so the
    // existing per-user fallback (or the provider's own message) still runs.
    if (!key || !address || !billing) throw original;
    if (!billing.overflowEnabled) throw new QuotaExceeded('overflow-disabled');
    if (billing.credits <= 0) throw new QuotaExceeded('no-credits');
    if ((await overflowSpentToday(db, address, now())) >= DAILY_OVERFLOW_CAP) {
      throw new QuotaExceeded('daily-cap');
    }
    await spendOne('overflow');
    notice = 'Your key hit its limit — used 1 credit';
    active = { provider: hostedProvider(key, factory), model: HOSTED_MODEL, source: 'hosted' };
  };

  const call = async <T>(method: string, fn: (provider: AIProvider) => Promise<T>): Promise<T> => {
    const callId = crypto.randomUUID();
    const paid = active.source === 'hosted';
    if (paid) await spendOne('analysis');
    return attempt(method, fn, callId, paid, false);
  };

  return {
    get id() {
      return active.provider.id;
    },
    get source() {
      return active.source;
    },
    get notice() {
      return notice;
    },
    analyzeMeal: (image, options?: AnalyzeMealOptions) =>
      call('analyzeMeal', (provider) => provider.analyzeMeal(image, options)),
    analyzeText: (description, options?: AnalyzeTextOptions) =>
      call('analyzeText', (provider) => provider.analyzeText(description, options)),
    reviseMeal: (current: ReviseMealInput, instruction: string, options?: ReviseMealOptions) =>
      call('reviseMeal', (provider) => provider.reviseMeal(current, instruction, options)),
    coachReply: (context: string, question: string, options?: CoachOptions) =>
      call('coachReply', (provider) => provider.coachReply(context, question, options)),
  };
}

function hostedProvider(key: string, factory: ProviderFactory): AIProvider {
  return factory({ apiKey: key, provider: HOSTED_PROVIDER_ID, model: HOSTED_MODEL });
}
