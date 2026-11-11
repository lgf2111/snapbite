import { env } from 'cloudflare:test';
import { type AIFoodAnalysis, type AIProvider, encryptSecret } from '@snapbite/core';
import { describe, expect, it } from 'vitest';
import {
  DAILY_OVERFLOW_CAP,
  HOSTED_MODEL,
  HOSTED_PROVIDER_ID,
  type ProviderChoice,
  QuotaExceeded,
  isQuotaWall,
  resolveProviderForUser,
} from './provider.js';

const db = () => env.DB;
const MASTER_KEY = env.ENCRYPTION_KEY as string;
const HOSTED_KEY = 'hosted-gemini-key';

const analysis = { foods: [], confidence: 0.9, flags: [] } as unknown as AIFoodAnalysis;

interface TestUser {
  id: string;
  email: string;
}

async function makeUser(opts: {
  key?: string;
  credits?: number;
  email?: string | null;
  overflowEnabled?: boolean;
  aiProvider?: string;
  aiModel?: string | null;
}): Promise<TestUser> {
  const id = crypto.randomUUID();
  const email =
    opts.email === null ? null : (opts.email ?? `${crypto.randomUUID()}@example.com`).toLowerCase();
  await db()
    .prepare('INSERT INTO users (id, email, email_verified_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, email, email ? Date.now() : null, Date.now())
    .run();

  const secret = opts.key ? await encryptSecret(opts.key, MASTER_KEY) : null;
  await db()
    .prepare(
      `INSERT INTO settings
         (user_id, ai_provider, ai_model, api_key_ciphertext, api_key_iv, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      opts.aiProvider ?? 'gemini',
      opts.aiModel ?? null,
      secret?.ciphertext ?? null,
      secret?.iv ?? null,
      Date.now(),
    )
    .run();

  if (email) {
    await db()
      .prepare(
        `INSERT INTO billing_accounts
           (email, credits, overflow_enabled, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(email, opts.credits ?? 0, opts.overflowEnabled === false ? 0 : 1, Date.now())
      .run();
  }
  return { id, email: email ?? '' };
}

function providerWith(id: string, impl: Partial<AIProvider> = {}): AIProvider {
  return {
    id,
    analyzeMeal: async () => analysis,
    analyzeText: async () => analysis,
    reviseMeal: async () => analysis,
    coachReply: async () => 'ok',
    ...impl,
  };
}

function failing(status: number, message = 'quota exceeded'): AIProvider {
  const err = Object.assign(new Error(message), { kind: 'http', status });
  return providerWith('byok-mock', {
    analyzeMeal: async () => {
      throw err;
    },
    analyzeText: async () => {
      throw err;
    },
    reviseMeal: async () => {
      throw err;
    },
    coachReply: async () => {
      throw err;
    },
  });
}

function factoryFor(map: Record<string, AIProvider>): (choice: ProviderChoice) => AIProvider {
  return (choice) => {
    const provider = map[choice.apiKey];
    if (!provider) throw new Error(`unexpected key ${choice.apiKey}`);
    return provider;
  };
}

async function creditsOf(email: string): Promise<number> {
  const row = await db()
    .prepare('SELECT credits FROM billing_accounts WHERE email = ?')
    .bind(email)
    .first<{ credits: number }>();
  return row?.credits ?? 0;
}

async function ledger(email: string) {
  const { results } = await db()
    .prepare('SELECT delta, reason FROM credit_ledger WHERE email = ? ORDER BY rowid')
    .bind(email)
    .all<{ delta: number; reason: string }>();
  return results;
}

async function usage(userId: string) {
  const { results } = await db()
    .prepare(
      `SELECT provider, model, ok, kind, request_id
         FROM ai_usage WHERE user_id = ? ORDER BY rowid`,
    )
    .bind(userId)
    .all<{
      provider: string;
      model: string;
      ok: number;
      kind: string;
      request_id: string;
    }>();
  return results;
}

const runtime = (hostedKey: string | null = HOSTED_KEY) => ({
  ENCRYPTION_KEY: MASTER_KEY,
  ...(hostedKey ? { GEMINI_API_KEY: hostedKey } : {}),
});

describe('resolveProviderForUser', () => {
  const NOW = Date.UTC(2026, 10, 12, 12);

  it('uses a stored BYOK key and spends nothing', async () => {
    const user = await makeUser({ key: 'byok-key', credits: 5 });
    const provider = await resolveProviderForUser(db(), runtime(), user.id, {
      providerFactory: factoryFor({ 'byok-key': providerWith('byok-mock') }),
      now: () => NOW,
    });

    const result = await provider.analyzeMeal({ base64: 'AA==', mimeType: 'image/jpeg' });
    expect(result).toBe(analysis);
    expect(provider.source).toBe('byok');
    expect(provider.notice).toBeNull();
    expect(await creditsOf(user.email)).toBe(5);
    expect(await ledger(user.email)).toHaveLength(0);

    const rows = await usage(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'byok-mock',
      model: 'gemini-3.6-flash',
      ok: 1,
      kind: 'analyzeMeal',
    });
  });

  it('spends exactly one credit on a 429 and retries once on the hosted key', async () => {
    const user = await makeUser({ key: 'byok-key', credits: 2 });
    const calls: ProviderChoice[] = [];
    const provider = await resolveProviderForUser(db(), runtime(), user.id, {
      providerFactory: (choice) => {
        calls.push(choice);
        return choice.apiKey === HOSTED_KEY ? providerWith('hosted-mock') : failing(429);
      },
      now: () => NOW,
    });

    const result = await provider.analyzeMeal({ base64: 'AA==', mimeType: 'image/jpeg' });
    expect(result).toBe(analysis);
    expect(await creditsOf(user.email)).toBe(1);
    expect(await ledger(user.email)).toEqual([{ delta: -1, reason: 'overflow' }]);
    expect(provider.source).toBe('hosted');
    expect(provider.notice).toBe('Your key hit its limit — used 1 credit');

    // The retry is exactly one call, pinned to the hosted provider + model.
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      apiKey: HOSTED_KEY,
      provider: HOSTED_PROVIDER_ID,
      model: HOSTED_MODEL,
    });

    const rows = await usage(user.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ provider: 'byok-mock', ok: 0, kind: 'analyzeMeal' });
    expect(rows[1]).toMatchObject({ provider: 'hosted-mock', ok: 1, kind: 'analyzeMeal' });
    expect(rows[0]?.request_id).toBe(rows[1]?.request_id);
  });

  it('spends nothing on a 500 and never retries on the hosted key', async () => {
    const user = await makeUser({ key: 'byok-key', credits: 2 });
    let hostedCalls = 0;
    const provider = await resolveProviderForUser(db(), runtime(), user.id, {
      providerFactory: (choice) => {
        if (choice.apiKey === HOSTED_KEY) hostedCalls += 1;
        return failing(500, 'provider down');
      },
      now: () => NOW,
    });

    await expect(provider.analyzeText('a bowl of rice')).rejects.toThrow('provider down');
    expect(await creditsOf(user.email)).toBe(2);
    expect(await ledger(user.email)).toHaveLength(0);
    expect(hostedCalls).toBe(0);
    expect(await usage(user.id)).toHaveLength(1);
  });

  it('refuses the 21st overflow of the day without spending', async () => {
    const user = await makeUser({ key: 'byok-key', credits: DAILY_OVERFLOW_CAP + 1 });
    for (let i = 0; i < DAILY_OVERFLOW_CAP; i++) {
      await db()
        .prepare(
          `INSERT INTO credit_ledger (id, email, delta, reason, created_at)
           VALUES (?, ?, -1, 'overflow', ?)`,
        )
        .bind(crypto.randomUUID(), user.email, NOW - i * 1000)
        .run();
    }

    const provider = await resolveProviderForUser(db(), runtime(), user.id, {
      providerFactory: factoryFor({
        'byok-key': failing(429),
        [HOSTED_KEY]: providerWith('hosted'),
      }),
      now: () => NOW,
    });

    await expect(
      provider.analyzeMeal({ base64: 'AA==', mimeType: 'image/jpeg' }),
    ).rejects.toMatchObject({ reason: 'daily-cap' });
    expect(await creditsOf(user.email)).toBe(DAILY_OVERFLOW_CAP + 1);
    expect(await ledger(user.email)).toHaveLength(DAILY_OVERFLOW_CAP);
    expect(await usage(user.id)).toHaveLength(1);
  });

  it('returns a typed refusal when the signed-in account has no credits', async () => {
    const user = await makeUser({ key: 'byok-key', credits: 0 });
    const provider = await resolveProviderForUser(db(), runtime(), user.id, {
      providerFactory: factoryFor({ 'byok-key': failing(429) }),
      now: () => NOW,
    });

    await expect(
      provider.analyzeMeal({ base64: 'AA==', mimeType: 'image/jpeg' }),
    ).rejects.toBeInstanceOf(QuotaExceeded);
    await expect(
      provider.analyzeMeal({ base64: 'AA==', mimeType: 'image/jpeg' }),
    ).rejects.toMatchObject({ reason: 'no-credits', status: 402 });
    expect(await creditsOf(user.email)).toBe(0);
    expect(await ledger(user.email)).toHaveLength(0);
  });

  it('uses the hosted key with no stored key and charges one credit per call', async () => {
    const user = await makeUser({ credits: 3 });
    const calls: ProviderChoice[] = [];
    const provider = await resolveProviderForUser(db(), runtime(), user.id, {
      providerFactory: (choice) => {
        calls.push(choice);
        return providerWith('hosted-mock');
      },
      now: () => NOW,
    });

    await provider.analyzeText('two eggs and toast');
    expect(await creditsOf(user.email)).toBe(2);
    expect(await ledger(user.email)).toEqual([{ delta: -1, reason: 'analysis' }]);
    expect(provider.source).toBe('hosted');
    expect(calls[0]).toMatchObject({
      apiKey: HOSTED_KEY,
      provider: HOSTED_PROVIDER_ID,
      model: HOSTED_MODEL,
    });
    expect(await usage(user.id)).toHaveLength(1);
  });

  it('refunds the credit when a paid hosted call fails', async () => {
    const user = await makeUser({ credits: 2 });
    const provider = await resolveProviderForUser(db(), runtime(), user.id, {
      providerFactory: () => failing(500, 'hosted down'),
      now: () => NOW,
    });

    await expect(provider.analyzeText('soup')).rejects.toThrow('hosted down');
    expect(await creditsOf(user.email)).toBe(2);
    expect(await ledger(user.email)).toEqual([
      { delta: -1, reason: 'analysis' },
      { delta: 1, reason: 'refund' },
    ]);
  });

  it('refuses without a key or hosted configuration', async () => {
    const user = await makeUser({ email: null });
    await expect(
      resolveProviderForUser(db(), runtime(null), user.id, { providerFactory: () => failing(429) }),
    ).rejects.toMatchObject({ reason: 'no-access', status: 400 });
  });
});

describe('isQuotaWall', () => {
  it('accepts 429 and 403 quotaExceeded only', () => {
    expect(isQuotaWall({ status: 429 })).toBe(true);
    expect(isQuotaWall({ status: 403, message: 'quotaExceeded' })).toBe(true);
    expect(isQuotaWall({ status: 403, message: 'RESOURCE_EXHAUSTED' })).toBe(true);
    expect(isQuotaWall({ status: 403, message: 'permission denied' })).toBe(false);
  });

  it('never treats a 5xx, 401 or network error as a quota wall', () => {
    expect(isQuotaWall({ status: 500 })).toBe(false);
    expect(isQuotaWall({ status: 503 })).toBe(false);
    expect(isQuotaWall({ status: 401, message: 'quotaExceeded' })).toBe(false);
    expect(isQuotaWall(new Error('network down'))).toBe(false);
  });
});
