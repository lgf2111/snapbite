import {
  applyAnswer,
  type BotReply,
  broadcastMessage,
  computeTargets,
  createProvider,
  CURRENT_CHANGELOG,
  decryptSecret,
  FEEDBACK_MAX_LEN,
  FEEDBACK_PROMPT,
  FEEDBACK_THANKS,
  GOAL_LABELS,
  type OnboardingState,
  type ParsedCommand,
  parseUpdate,
  photoLoggedReply,
  promptFor,
  replyForCommand,
  resolveMeal,
  startOnboarding,
  type TelegramUpdate,
  type UserProfile,
} from '@snapbite/core';
import { type Context, Hono } from 'hono';
import { describeError, logError, recentErrors } from '../db/errors.js';
import { recentFeedback, storeFeedback } from '../db/feedback.js';
import {
  createMealsDb,
  findMealByMessageId,
  getMealDetail,
  type MealTelegramRef,
  recentMealsForUser,
  saveMeal,
  updateMeal,
} from '../db/meals.js';
import {
  clearOnboardingState,
  createSettingsDb,
  getOnboardingState,
  getSettings,
  mergePreferences,
  parsePreferences,
  setOnboardingState,
} from '../db/settings.js';
import { createDb, listBroadcastTargets, setBroadcastRef, upsertUser } from '../db/users.js';
import { type AppBindings, parseAdminId } from '../env.js';
import { adminNotify } from '../adminNotify.js';
import { lookupBarcode } from '../openfoodfacts.js';
import { enqueuePhotoRetry } from '../photoRetry.js';
import { TelegramBotClient } from '../telegram/botClient.js';
import { detailToAnalysis, primaryProviderChoice, type ProviderFactory } from './meals.js';

/** The bot-client surface the webhook uses (so tests can mock just these). */
export interface BotClient {
  sendMessage(chatId: number, reply: BotReply): Promise<{ messageId: number | null }>;
  getFilePath(fileId: string): Promise<string | null>;
  downloadFile(filePath: string): Promise<{ base64: string; mimeType: string } | null>;
  /** Optional transient chat status (typing/upload_photo). Best-effort. */
  sendChatAction?(chatId: number, action: string): Promise<void>;
  /** Edit a message in place. Best-effort (false on failure, e.g. >48h). */
  editMessageText?(chatId: number, messageId: number, reply: BotReply): Promise<boolean>;
  /** Delete a message. Best-effort. */
  deleteMessage?(chatId: number, messageId: number): Promise<boolean>;
}

/** Injectable bot-client factory so tests can supply a mock (no network). */
export type BotClientFactory = (token: string) => BotClient;

const defaultBotClientFactory: BotClientFactory = (token) => new TelegramBotClient(token);

const defaultProviderFactory: ProviderFactory = ({ apiKey, provider, model }) =>
  createProvider({ providerId: provider, apiKey, ...(model ? { model } : {}) });

/** Header Telegram sends with the configured secret on each webhook call. */
const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

export interface WebhookDeps {
  botClientFactory?: BotClientFactory;
  providerFactory?: ProviderFactory;
}

/**
 * Telegram webhook. Verifies the shared secret, parses the update, and either
 * replies to a command or logs a photo sent straight to the bot chat.
 * Unauthenticated by initData — guarded by the secret token header.
 */
export function webhookRoutes(deps: WebhookDeps = {}) {
  const botClientFactory = deps.botClientFactory ?? defaultBotClientFactory;
  const providerFactory = deps.providerFactory ?? defaultProviderFactory;
  const app = new Hono<AppBindings>();

  app.post('/', async (c) => {
    const expected = c.env.TELEGRAM_WEBHOOK_SECRET;
    if (expected) {
      const got = c.req.header(SECRET_HEADER);
      if (got !== expected) return c.json({ error: 'Forbidden' }, 403);
    }

    let update: TelegramUpdate;
    try {
      update = await c.req.json();
    } catch {
      return c.json({ ok: true });
    }

    const parsed = parseUpdate(update);
    if (!parsed || !c.env.TELEGRAM_BOT_TOKEN) return c.json({ ok: true });

    const bot = botClientFactory(c.env.TELEGRAM_BOT_TOKEN);
    const miniAppUrl = c.env.MINI_APP_URL ?? '';

    // Photo sent to the bot -> analyze and auto-log.
    if (parsed.photoFileId && parsed.fromId != null) {
      const job: PhotoJob = {
        fileId: parsed.photoFileId,
        fromId: parsed.fromId,
        chatId: parsed.chatId,
        caption: parsed.caption,
      };
      try {
        await handlePhoto(c, bot, providerFactory, job);
      } catch (err) {
        const e = err as { message?: string; kind?: string; status?: number; cause?: unknown };
        // Persist to D1 (best-effort; also mirrors to console for `wrangler tail`).
        const desc = describeError(err);
        const detail =
          (typeof e.cause === 'string' ? e.cause : undefined) ?? desc.detail ?? null;
        await logError(c.env.DB, {
          telegramUserId: parsed.fromId,
          source: 'webhook',
          kind: desc.kind ?? 'photo',
          status: desc.status ?? null,
          message: desc.message,
          detail,
        });
        // Alert the owner — webhook/photo failures are user-facing. Best-effort.
        await adminNotify(
          c.env,
          bot,
          'error',
          `⚠️ Photo log failed for user ${parsed.fromId}: ${desc.message}`,
        );
        try {
          // Edit the "Analyzing…" message into the error (or send fresh if none).
          await replyOrEdit(bot, parsed.chatId, job.statusMessageId, {
            text: friendlyPhotoError(e),
          });
        } catch {
          /* ignore */
        }
      }
      return c.json({ ok: true });
    }

    // Stateful commands that need D1 / admin gating are handled here; everything
    // else falls through to the pure `replyForCommand`.
    if (parsed.command === 'feedback') {
      await handleFeedbackCommand(c, bot, parsed);
      return c.json({ ok: true });
    }
    if (parsed.command === 'errors') {
      await handleErrorsCommand(c, bot, parsed);
      return c.json({ ok: true });
    }
    if (parsed.command === 'broadcast') {
      await handleBroadcastCommand(c, bot, parsed);
      return c.json({ ok: true });
    }
    // Conversational profile setup by chat.
    if (parsed.command === 'setup' && parsed.fromId != null) {
      await handleSetupStart(c, bot, parsed);
      return c.json({ ok: true });
    }
    if (parsed.command === 'cancel' && parsed.fromId != null) {
      await handleSetupCancel(c, bot, parsed);
      return c.json({ ok: true });
    }

    // Plain text (no slash command). If the user is mid-onboarding, this is
    // their answer — handle it BEFORE the meal-revise flow (which also claims
    // plain text). Otherwise it's a "revise my last meal with AI" instruction.
    if (parsed.command === null && parsed.text.trim() && parsed.fromId != null) {
      const userDb = createDb(c.env.DB);
      const user = await upsertUser(userDb, { id: parsed.fromId });
      const settingsDb = createSettingsDb(c.env.DB);
      const onboarding = await getOnboardingState(settingsDb, user.id);
      if (onboarding) {
        await handleOnboardingAnswer(c, bot, parsed, user.id, onboarding);
      } else {
        await handleTextRevise(c, bot, providerFactory, parsed);
      }
      return c.json({ ok: true });
    }

    // Otherwise treat as a command / text message.
    const reply = replyForCommand(parsed, { miniAppUrl });
    if (reply) {
      try {
        await bot.sendMessage(parsed.chatId, reply);
      } catch (err) {
        console.error('sendMessage failed', err);
      }
    }
    return c.json({ ok: true });
  });

  return app;
}

/**
 * Best-effort DM to the owner (ADMIN_TELEGRAM_ID). No-ops when the id is unset
 * or when the admin id is the same chat that just errored is irrelevant — we
 * always send to the admin's own chat id. Never throws.
 */


/** Short human time (UTC) for admin listings. */
function shortTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

/** Telegram's edit window — a message can only be edited within ~48h of sending. */
const EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * `/broadcast` — ADMIN-only. Sends the current changelog to every user. For a
 * user whose last broadcast message is still editable (<48h old), it EDITS that
 * message in place to the newest version instead of sending a new one; otherwise
 * it sends fresh. Best-effort per user; reports a summary to the admin. In a
 * private chat the DM chat id equals the user's Telegram id, so we can reach
 * users we've never stored a chat id for.
 */
async function handleBroadcastCommand(
  c: Context<AppBindings>,
  bot: BotClient,
  parsed: ParsedCommand,
): Promise<void> {
  const adminId = parseAdminId(c.env.ADMIN_TELEGRAM_ID);
  const isAdmin = adminId != null && parsed.fromId === adminId;
  if (!isAdmin) {
    // Invisible to non-admins — behave like an unknown message.
    const reply = replyForCommand({ command: null }, { miniAppUrl: c.env.MINI_APP_URL ?? '' });
    if (reply) await bot.sendMessage(parsed.chatId, reply);
    return;
  }

  const entry = CURRENT_CHANGELOG;
  if (!entry) {
    await bot.sendMessage(parsed.chatId, { text: 'No changelog entry to broadcast.' });
    return;
  }
  const text = broadcastMessage(entry);
  const db = createDb(c.env.DB);
  const targets = await listBroadcastTargets(db);
  const now = Date.now();

  let edited = 0;
  let sent = 0;
  let failed = 0;

  for (const t of targets) {
    // The DM chat id: use the stored one if present, else the Telegram user id
    // (equal for private chats).
    const chatId = t.lastBroadcastChatId ?? t.telegramUserId;
    try {
      const canEdit =
        t.lastBroadcastMessageId != null &&
        t.lastBroadcastChatId != null &&
        t.lastBroadcastAt != null &&
        now - t.lastBroadcastAt < EDIT_WINDOW_MS &&
        t.lastBroadcastVersion !== entry.version; // no-op if already on this version

      let messageId: number | null = null;
      if (canEdit && bot.editMessageText && t.lastBroadcastMessageId != null) {
        const ok = await bot.editMessageText(t.lastBroadcastChatId as number, t.lastBroadcastMessageId, {
          text,
        });
        if (ok) {
          messageId = t.lastBroadcastMessageId;
          edited += 1;
        }
      }
      // Already on this version and still editable → skip (nothing to do).
      if (
        messageId == null &&
        t.lastBroadcastVersion === entry.version &&
        t.lastBroadcastAt != null &&
        now - t.lastBroadcastAt < EDIT_WINDOW_MS
      ) {
        continue;
      }
      // Edit didn't happen (too old / failed / first time) → send a new message.
      if (messageId == null) {
        const res = await bot.sendMessage(chatId, { text });
        messageId = res.messageId;
        if (messageId != null) sent += 1;
        else {
          failed += 1;
          continue;
        }
      }
      await setBroadcastRef(db, t.id, {
        chatId,
        messageId,
        version: entry.version,
        at: now,
      });
    } catch {
      failed += 1;
    }
  }

  const summary = `📣 Broadcast v${entry.version} done — ${sent} sent, ${edited} edited, ${failed} failed (of ${targets.length}).`;
  // Reply to the command where it was typed, and log a record to the broadcast topic.
  await bot.sendMessage(parsed.chatId, { text: summary });
  await adminNotify(c.env, bot, 'broadcast', summary);
}

/**
 * `/feedback <text>` — any user submits feedback: store it, DM the owner, and
 * confirm. `/feedback` with no text from the ADMIN shows the latest unhandled
 * feedback (owner review); from a normal user it just prompts for text.
 */
async function handleFeedbackCommand(
  c: Context<AppBindings>,
  bot: BotClient,
  parsed: ParsedCommand,
): Promise<void> {
  const adminId = parseAdminId(c.env.ADMIN_TELEGRAM_ID);
  const isAdmin = adminId != null && parsed.fromId === adminId;
  const text = parsed.args.trim();

  // Admin, no text -> review the latest feedback.
  if (isAdmin && !text) {
    const rows = await recentFeedback(c.env.DB, 10);
    if (rows.length === 0) {
      await bot.sendMessage(parsed.chatId, { text: 'No feedback yet. 🎉' });
      return;
    }
    const lines = rows.map(
      (r) => `• ${shortTime(r.createdAt)} — user ${r.telegramUserId ?? '?'} (${r.source}):\n  ${r.message}`,
    );
    await bot.sendMessage(parsed.chatId, {
      text: `🗒️ Latest feedback (${rows.length}):\n\n${lines.join('\n\n')}`,
    });
    return;
  }

  // No text -> prompt.
  if (!text) {
    await bot.sendMessage(parsed.chatId, { text: FEEDBACK_PROMPT });
    return;
  }

  // Store + forward.
  try {
    const row = await storeFeedback(c.env.DB, {
      telegramUserId: parsed.fromId,
      source: 'bot',
      message: text.slice(0, FEEDBACK_MAX_LEN),
    });
    await adminNotify(
      c.env,
      bot,
      'feedback',
      `📝 New feedback from user ${parsed.fromId}:\n${row.message}`,
    );
    await bot.sendMessage(parsed.chatId, { text: FEEDBACK_THANKS });
  } catch (err) {
    await logError(c.env.DB, {
      telegramUserId: parsed.fromId,
      source: 'webhook',
      kind: 'feedback',
      message: describeError(err).message,
    });
    await bot.sendMessage(parsed.chatId, {
      text: 'Sorry — could not save that just now. Please try again in a moment.',
    });
  }
}

/**
 * `/errors` — ADMIN-only: show the latest error_logs. Non-admins get the normal
 * fallback reply (the command is effectively invisible to them).
 */
async function handleErrorsCommand(
  c: Context<AppBindings>,
  bot: BotClient,
  parsed: ParsedCommand,
): Promise<void> {
  const adminId = parseAdminId(c.env.ADMIN_TELEGRAM_ID);
  const isAdmin = adminId != null && parsed.fromId === adminId;
  if (!isAdmin) {
    // Treat like an unknown message for non-admins — don't reveal the command.
    const reply = replyForCommand({ command: null }, { miniAppUrl: c.env.MINI_APP_URL ?? '' });
    if (reply) await bot.sendMessage(parsed.chatId, reply);
    return;
  }

  const rows = await recentErrors(c.env.DB, 10);
  if (rows.length === 0) {
    await bot.sendMessage(parsed.chatId, { text: 'No errors logged. ✅' });
    return;
  }
  const lines = rows.map((r) => {
    const who = r.telegramUserId ?? '—';
    const status = r.status != null ? ` ${r.status}` : '';
    return `• ${shortTime(r.createdAt)} [${r.source}/${r.kind}${status}] user ${who}\n  ${r.message}`;
  });
  await bot.sendMessage(parsed.chatId, {
    text: `⚠️ Latest errors (${rows.length}):\n\n${lines.join('\n\n')}`,
  });
}

// --- conversational profile setup (/setup) ---------------------------------

/** `/setup` — begin (or restart) conversational profile onboarding by chat. */
async function handleSetupStart(
  c: Context<AppBindings>,
  bot: BotClient,
  parsed: ParsedCommand,
): Promise<void> {
  const userDb = createDb(c.env.DB);
  const user = await upsertUser(userDb, { id: parsed.fromId as number });
  const settingsDb = createSettingsDb(c.env.DB);
  const { state, prompt } = startOnboarding();
  await setOnboardingState(settingsDb, user.id, state);
  await bot.sendMessage(parsed.chatId, {
    text: `${prompt}\n\n(You can stop anytime with /cancel.)`,
  });
}

/** `/cancel` — abandon an in-progress setup. No-op message if none active. */
async function handleSetupCancel(
  c: Context<AppBindings>,
  bot: BotClient,
  parsed: ParsedCommand,
): Promise<void> {
  const userDb = createDb(c.env.DB);
  const user = await upsertUser(userDb, { id: parsed.fromId as number });
  const settingsDb = createSettingsDb(c.env.DB);
  await clearOnboardingState(settingsDb, user.id);
  await bot.sendMessage(parsed.chatId, {
    text: 'No problem — setup cancelled. Send /setup anytime to try again.',
  });
}

/** A short human summary of computed daily targets. */
function targetsSummary(profile: UserProfile): string {
  const t = computeTargets(profile);
  return [
    `🎯 Your daily targets (${GOAL_LABELS[profile.goal]}):`,
    `🔥 ${t.energyKcal} kcal`,
    `🥩 Protein ${t.proteinG} g`,
    `🍚 Carbs ${t.carbsG} g`,
    `🧈 Fat ${t.fatG} g`,
    '',
    'These are estimates — tweak them anytime in SnapBite → Settings.',
  ].join('\n');
}

/**
 * Handles a plain-text answer while the user is mid-onboarding. Re-prompts on a
 * bad answer, advances on a good one, and on the final step validates + saves
 * the profile, shows targets, clears the state, and nudges to add an AI key if
 * none is stored yet.
 */
async function handleOnboardingAnswer(
  c: Context<AppBindings>,
  bot: BotClient,
  parsed: ParsedCommand,
  userId: string,
  state: OnboardingState,
): Promise<void> {
  const settingsDb = createSettingsDb(c.env.DB);
  const miniAppUrl = c.env.MINI_APP_URL ?? '';
  const result = applyAnswer(state, parsed.text);

  if (!result.ok) {
    // Bad answer — show the error and re-ask the same step.
    await bot.sendMessage(parsed.chatId, { text: `${result.error}\n\n${promptFor(state.step)}` });
    return;
  }

  if (!result.done) {
    // Advance to the next step.
    await setOnboardingState(settingsDb, userId, result.state);
    await bot.sendMessage(parsed.chatId, { text: result.nextPrompt });
    return;
  }

  // Complete — persist the profile, show targets, clear onboarding.
  await mergePreferences(settingsDb, userId, { profile: result.profile });
  await clearOnboardingState(settingsDb, userId);

  const settings = await getSettings(settingsDb, userId);
  const hasKey = Boolean(settings?.apiKeyCiphertext && settings?.apiKeyIv);

  const lines = ['✅ All set!', '', targetsSummary(result.profile)];
  if (hasKey) {
    lines.push(
      '',
      "Your AI key is already saved, so photo logging works. To change it, open SnapBite → Settings — I don't take API keys over chat, since anything you type here stays in your Telegram history.",
    );
  } else {
    lines.push(
      '',
      'One more thing: to log meals from photos, add your AI key in SnapBite → Settings. I ask for it there rather than over chat, because a key typed into this chat would be saved in your Telegram history — the Settings screen sends it securely instead. (You can still add meals by hand without a key.)',
    );
  }
  await bot.sendMessage(parsed.chatId, {
    text: lines.join('\n'),
    ...(miniAppUrl
      ? { replyMarkup: { inline_keyboard: [[{ text: '🍽️ Open SnapBite', web_app: { url: miniAppUrl } }]] } }
      : {}),
  });
}

/**
 * How far back a plain-text message can auto-target a meal without a reply.
 * Within this window a single recent meal is unambiguous; 2+ triggers the
 * "reply to the specific meal" prompt.
 */
const REVISE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Plain text sent to the bot (no slash command) = "revise my last meal with
 * AI". Targeting:
 *  - If the message is a REPLY to a bot confirmation, revise that exact meal.
 *  - Else if exactly one meal was logged in the last {@link REVISE_WINDOW_MS},
 *    revise it.
 *  - Else if 2+ recent meals, ask the user to reply to the specific one.
 *  - Else (no recent meal) nudge toward sending a photo.
 * On success the meal's confirmation message is edited in place (best-effort;
 * Telegram allows edits for ~48h).
 */
async function handleTextRevise(
  c: Context<AppBindings>,
  bot: BotClient,
  providerFactory: ProviderFactory,
  parsed: ParsedCommand,
): Promise<void> {
  const { chatId, fromId, text } = parsed;
  const miniAppUrl = c.env.MINI_APP_URL ?? '';
  const instruction = text.trim();

  const userDb = createDb(c.env.DB);
  const user = await upsertUser(userDb, { id: fromId as number });

  // Need a key to run the AI revise.
  const settingsDb = createSettingsDb(c.env.DB);
  const settings = await getSettings(settingsDb, user.id);
  if (!c.env.ENCRYPTION_KEY || !settings?.apiKeyCiphertext || !settings?.apiKeyIv) {
    await bot.sendMessage(chatId, {
      text: 'Send me a meal photo to log it, or open SnapBite to add your AI key and review your history.',
      ...(miniAppUrl
        ? { replyMarkup: { inline_keyboard: [[{ text: '🍽️ Open SnapBite', web_app: { url: miniAppUrl } }]] } }
        : {}),
    });
    return;
  }

  const mealsDb = createMealsDb(c.env.DB);

  // 1) Reply targeting wins.
  let target: MealTelegramRef | undefined;
  if (parsed.replyToMessageId != null) {
    target = await findMealByMessageId(mealsDb, user.id, parsed.replyToMessageId);
    if (!target) {
      await bot.sendMessage(chatId, {
        text: "I couldn't match that reply to one of your logged meals. Reply to a meal's summary message and tell me the change.",
      });
      return;
    }
  } else {
    // 2) Otherwise look at recent meals.
    const recent = await recentMealsForUser(mealsDb, user.id, Date.now() - REVISE_WINDOW_MS, 5);
    if (recent.length === 0) {
      await bot.sendMessage(chatId, {
        text: 'Send me a meal photo to log it first — then reply with a change and I\'ll update it.',
        ...(miniAppUrl
          ? { replyMarkup: { inline_keyboard: [[{ text: '🍽️ Open SnapBite', web_app: { url: miniAppUrl } }]] } }
          : {}),
      });
      return;
    }
    if (recent.length > 1) {
      // 3) Ambiguous — ask them to reply to the specific meal message.
      await bot.sendMessage(chatId, {
        text: 'You logged a few meals just now — reply directly to the summary of the one you want to change, then tell me the update.',
      });
      return;
    }
    target = recent[0];
  }

  if (!target) {
    await bot.sendMessage(chatId, { text: "Sorry — I couldn't find a meal to update." });
    return;
  }

  // Load the full meal, revise via AI, save, and edit the confirmation in place.
  const detail = await getMealDetail(mealsDb, target.id, user.id);
  if (!detail) {
    await bot.sendMessage(chatId, { text: "Sorry — I couldn't load that meal to update it." });
    return;
  }

  const apiKey = await decryptSecret(
    { ciphertext: settings.apiKeyCiphertext, iv: settings.apiKeyIv },
    c.env.ENCRYPTION_KEY,
  );

  await bot.sendChatAction?.(chatId, 'typing');
  const provider = providerFactory(primaryProviderChoice(settings, apiKey));
  const analysis = await provider.reviseMeal(detailToAnalysis(detail), instruction, {});
  const meal = resolveMeal(analysis);
  await updateMeal(mealsDb, target.id, user.id, meal);

  const foods = meal.foods.map((f) => f.food.name);
  const reply = photoLoggedReply(
    foods,
    {
      energyKcal: meal.total.energyKcal,
      proteinG: meal.total.proteinG,
      carbsG: meal.total.carbsG,
      fatG: meal.total.fatG,
    },
    { miniAppUrl },
  );
  // Edit the original confirmation in place when we can; otherwise send fresh.
  const ref =
    target.telegramChatId != null && target.telegramMessageId != null
      ? { chatId: target.telegramChatId, messageId: target.telegramMessageId }
      : { chatId, messageId: null };
  const editedInPlace = await replyOrEdit(bot, ref.chatId, ref.messageId, reply);

  const wasReply = parsed.replyToMessageId != null;
  if (wasReply && ref.messageId != null) {
    // User explicitly replied to a meal: acknowledge with an "Updated" message
    // that itself replies to the (now-edited) confirmation, so it's clear which
    // meal changed.
    await bot.sendMessage(chatId, {
      text: '✅ Updated.',
      replyToMessageId: ref.messageId,
    });
  } else if (editedInPlace == null || ref.chatId !== chatId) {
    // Couldn't edit in place (or it lives in another chat) — send a plain ack so
    // the user still gets confirmation.
    await bot.sendMessage(chatId, { text: '✅ Updated your meal.' });
  }
}

/** Extract a human message from a provider error body ({error:{message}}). */
function providerMessage(cause: unknown): string | undefined {
  if (typeof cause !== 'string' || !cause.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(cause);
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    const msg = (obj as { error?: { message?: unknown } })?.error?.message;
    return typeof msg === 'string' ? msg : undefined;
  } catch {
    return undefined;
  }
}

interface ProviderErrorLike {
  message?: string;
  kind?: string;
  status?: number;
  cause?: unknown;
}

/**
 * Whether an error is a transient "model overloaded / temporarily unavailable"
 * case worth auto-retrying. Providers are inconsistent: Gemini's overload can
 * arrive as HTTP 503, 500, or even 429/200 with the overload wording only in
 * the body — so we match BOTH the status AND the message/cause text. This must
 * stay in sync with the 503 branch of {@link friendlyPhotoError} so we never
 * show "the model is busy, send again" without having actually retried.
 */
function isOverloadError(err: unknown): boolean {
  const e = err as ProviderErrorLike;
  if (e.status === 503 || e.status === 500) return true;
  const raw = `${providerMessage(e.cause) ?? ''} ${e.message ?? ''}`;
  return /overloaded|high demand|unavailable|temporarily|try again|UNAVAILABLE/i.test(raw);
}

/**
 * Turns a provider error into a short, friendly chat message. The two common
 * cases with the free Gemini tier get tailored guidance:
 * - 429 (quota/rate limit): daily free-tier cap or per-minute rate.
 * - 503 (overloaded): transient demand spike, retry shortly.
 * Everything else falls back to the provider's own message.
 */
function friendlyPhotoError(e: ProviderErrorLike): string {
  const raw = providerMessage(e.cause) ?? e.message ?? '';
  if (e.status === 402 || /credit|billing|insufficient|balance|payment|prepay/i.test(raw)) {
    return (
      "Sorry — your AI provider needs billing set up (it reported a credit/billing problem). " +
      'Add credit/billing to that key, or set a working fallback provider in SnapBite → Settings.'
    );
  }
  if (e.status === 429 || /quota|rate limit|resource_exhausted|exceeded/i.test(raw)) {
    return (
      "Sorry — your AI provider's rate limit was hit. On the free tier this is usually a daily " +
      'cap or a short per-minute limit. Wait a bit and send the photo again, or switch model/' +
      'provider in SnapBite → Settings.'
    );
  }
  if (e.status === 503 || /overloaded|high demand|unavailable/i.test(raw)) {
    return 'Sorry — the AI model is busy right now (a temporary demand spike). Please send the photo again in a moment.';
  }
  return `Sorry — couldn't log that photo: ${raw || 'unknown error'}`;
}

/**
 * Errors worth failing over to the fallback provider for. Covers rate limits
 * (429), overload (503), billing/credit problems (402, e.g. "prepayment credits
 * are needed" / "insufficient balance"), and any other server/quota-ish failure
 * — essentially anything except a clearly non-recoverable client error (400
 * bad request) or an auth failure (401/403), where a different provider's key
 * wouldn't help and should surface the real message instead.
 */
function isFailoverError(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status === 429 || status === 503 || status === 402) return true;
  // Any other 4xx/5xx except bad-request/auth is worth trying the fallback.
  if (typeof status === 'number' && status >= 402 && status !== 403) return true;

  const raw = (providerMessage((err as { cause?: unknown }).cause) ?? '') +
    ' ' +
    ((err as { message?: string }).message ?? '');
  return /quota|rate limit|resource_exhausted|overloaded|high demand|unavailable|credit|billing|insufficient|balance|payment|prepay|exceeded/i.test(
    raw,
  );
}

/** The result of an analysis, tagged with which provider actually produced it. */
type AnalysisResult = {
  analysis: Awaited<ReturnType<ReturnType<ProviderFactory>['analyzeMeal']>>;
  provider: string;
};

/**
 * Retries meal analysis with the user's configured fallback provider when the
 * primary hits a quota/overload error. If there's no fallback (or the error
 * isn't a failover case), the original error is rethrown so the caller reports
 * it. Returns the revised analysis tagged with the fallback provider id.
 */
async function tryFallback(
  c: Context<AppBindings>,
  primaryErr: unknown,
  image: { base64: string; mimeType: 'image/jpeg' },
  opts: { hint?: string },
  providerFactory: ProviderFactory,
  userId: string,
): Promise<AnalysisResult> {
  if (!isFailoverError(primaryErr) || !c.env.ENCRYPTION_KEY) throw primaryErr;

  const settingsDb = createSettingsDb(c.env.DB);
  const row = await getSettings(settingsDb, userId);
  const fb = parsePreferences(row?.preferencesJson).fallback;
  // No fallback stored, or it's been toggled off — surface the primary error.
  if (!fb?.keyCiphertext || !fb?.keyIv || fb.enabled === false) throw primaryErr;

  const fbKey = await decryptSecret(
    { ciphertext: fb.keyCiphertext, iv: fb.keyIv },
    c.env.ENCRYPTION_KEY,
  );
  const fbProvider = providerFactory({
    apiKey: fbKey,
    provider: fb.provider,
    model: fb.model,
    ...(fb.baseUrl ? { baseUrl: fb.baseUrl } : {}),
    ...(fb.supportsDetail != null ? { supportsDetail: fb.supportsDetail } : {}),
  });
  const analysis = await analyzeWithRetry(fbProvider, image, opts);
  return { analysis, provider: fb.provider };
}

/**
 * How many times to retry a transient 503 ("model overloaded"). Kept modest so
 * the whole webhook (multiple AI calls + backoff) stays well under Cloudflare's
 * request time limit and doesn't 524.
 */
const MAX_503_RETRIES = 3;
/** Base backoff between 503 retries (ms); grows linearly, capped, per attempt. */
const RETRY_BACKOFF_MS = 1200;
/** Max backoff for a single retry wait (ms). */
const RETRY_BACKOFF_CAP_MS = 4000;

/**
 * Runs `analyzeMeal`, retrying transient "model overloaded / temporarily
 * unavailable" errors up to {@link MAX_503_RETRIES} times with a short
 * increasing backoff. Overload is detected by status AND body text (see
 * {@link isOverloadError}), since providers report it inconsistently — this way
 * the user never sees "the model is busy, send again" without us having already
 * retried. Any non-overload error is thrown immediately (the caller decides
 * whether to fail over). If overload persists past the limit, the last error is
 * thrown so the caller can fall back or report it.
 */
async function analyzeWithRetry(
  provider: ReturnType<ProviderFactory>,
  image: { base64: string; mimeType: 'image/jpeg' },
  opts: { hint?: string },
): Promise<Awaited<ReturnType<ReturnType<ProviderFactory>['analyzeMeal']>>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_503_RETRIES; attempt++) {
    try {
      return await provider.analyzeMeal(image, opts);
    } catch (err) {
      lastErr = err;
      if (!isOverloadError(err)) throw err;
      if (attempt < MAX_503_RETRIES) {
        const wait = Math.min(RETRY_BACKOFF_MS * (attempt + 1), RETRY_BACKOFF_CAP_MS);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

/**
 * For each analyzed food that carries a barcode, look it up in Open Food Facts
 * and, on a hit, overwrite that food's nutrition with the product's EXACT
 * per-100g values (set as `manualNutrition`, which the resolver uses verbatim
 * and tags `manual`). Also adopts the OFF product name. Mutates `analysis` in
 * place. Returns the provider label to record — `openfoodfacts` if any food was
 * enriched, otherwise the original provider. Best-effort; never throws.
 */
async function enrichWithBarcodes(
  analysis: { foods: Array<Record<string, unknown>> },
  originalProvider: string,
): Promise<string> {
  let enrichedAny = false;
  for (const food of analysis.foods) {
    const barcode = typeof food.barcode === 'string' ? food.barcode : undefined;
    if (!barcode) continue;
    try {
      const product = await lookupBarcode(barcode);
      if (!product) continue;
      food.name = product.name;
      // Prefer OFF's declared serving size for the eaten amount when present;
      // else keep the model's weight estimate (default 100g if missing).
      const weight =
        product.servingG && product.servingG > 0
          ? product.servingG
          : typeof food.estimatedWeightG === 'number' && food.estimatedWeightG > 0
            ? food.estimatedWeightG
            : 100;
      const qty = typeof food.quantity === 'number' && food.quantity > 0 ? food.quantity : 1;
      const grams = weight * qty;
      const factor = grams / 100;
      food.estimatedWeightG = weight;
      // `manualNutrition` is ABSOLUTE whole-food macros (resolver uses verbatim),
      // so scale OFF's per-100g figures by the eaten grams.
      food.manualNutrition = {
        energyKcal: Math.round(product.per100g.energyKcal * factor * 10) / 10,
        proteinG: Math.round(product.per100g.proteinG * factor * 10) / 10,
        carbsG: Math.round(product.per100g.carbsG * factor * 10) / 10,
        fatG: Math.round(product.per100g.fatG * factor * 10) / 10,
      };
      enrichedAny = true;
    } catch {
      /* leave the AI estimate for this food */
    }
  }
  return enrichedAny ? 'openfoodfacts' : originalProvider;
}

interface PhotoJob {
  fileId: string;
  fromId: number;
  chatId: number;
  caption: string;
  /** message_id of the "Analyzing…" ack, set once sent so errors can edit it. */
  statusMessageId?: number | null;
}

/** Downloads the photo, runs the pipeline with the user's key, saves, and replies. */
async function handlePhoto(
  c: Context<AppBindings>,
  bot: BotClient,
  providerFactory: ProviderFactory,
  job: PhotoJob,
): Promise<void> {
  const { fileId, fromId, chatId, caption } = job;
  const miniAppUrl = c.env.MINI_APP_URL ?? '';

  // Resolve (or create) the app user for this Telegram id.
  const userDb = createDb(c.env.DB);
  const user = await upsertUser(userDb, { id: fromId });

  // Need the user's encrypted key.
  if (!c.env.ENCRYPTION_KEY) {
    await bot.sendMessage(chatId, { text: 'Server not configured for analysis yet.' });
    return;
  }
  const settingsDb = createSettingsDb(c.env.DB);
  const settings = await getSettings(settingsDb, user.id);
  if (!settings?.apiKeyCiphertext || !settings?.apiKeyIv) {
    await bot.sendMessage(chatId, {
      text: 'Add your AI key first: open SnapBite → Settings, then send the photo again.',
      ...(miniAppUrl
        ? {
            replyMarkup: {
              inline_keyboard: [[{ text: '⚙️ Open SnapBite', web_app: { url: miniAppUrl } }]],
            },
          }
        : {}),
    });
    return;
  }

  const apiKey = await decryptSecret(
    { ciphertext: settings.apiKeyCiphertext, iv: settings.apiKeyIv },
    c.env.ENCRYPTION_KEY,
  );

  // Let the user know we're on it — a transient "uploading photo…" status plus
  // a quick acknowledgement message that we later EDIT IN PLACE into the result
  // (so there's a single message that transforms, not a growing thread).
  await bot.sendChatAction?.(chatId, 'upload_photo');
  const ack = await bot.sendMessage(chatId, { text: '📸 Analyzing your meal…' });
  job.statusMessageId = ack.messageId;

  // Download the image bytes from Telegram, analyze, and discard.
  const filePath = await bot.getFilePath(fileId);
  if (!filePath) {
    await replyOrEdit(bot, chatId, job.statusMessageId, {
      text: 'Could not fetch that photo from Telegram.',
    });
    return;
  }
  const file = await bot.downloadFile(filePath);
  if (!file) {
    await replyOrEdit(bot, chatId, job.statusMessageId, {
      text: 'Could not download that photo.',
    });
    return;
  }

  const provider = providerFactory(primaryProviderChoice(settings, apiKey));
  const image = { base64: file.base64, mimeType: file.mimeType as 'image/jpeg' };
  const opts = caption ? { hint: caption } : {};

  // Analyze on the primary, retrying transient 503s a few times, then fall over
  // to the fallback provider on any failover-worthy error.
  let analysis: Awaited<ReturnType<typeof provider.analyzeMeal>>;
  let usedProvider = settings.aiProvider;
  try {
    analysis = await analyzeWithRetry(provider, image, opts);
  } catch (err) {
    try {
      const fb = await tryFallback(c, err, image, opts, providerFactory, user.id);
      analysis = fb.analysis;
      usedProvider = fb.provider;
    } catch (finalErr) {
      // Primary (after inline retries) AND fallback both failed. If it's a
      // transient overload, queue a DELAYED auto-retry (cron re-analyzes in a
      // few minutes and edits this message into the result) instead of making
      // the user resend. Any other error surfaces normally.
      if (isOverloadError(finalErr)) {
        await enqueuePhotoRetry(c.env.DB, {
          userId: user.id,
          telegramUserId: fromId,
          chatId,
          statusMessageId: job.statusMessageId ?? null,
          fileId,
          caption,
        });
        await replyOrEdit(bot, chatId, job.statusMessageId, {
          text: "⏳ The AI is busy right now — I'll keep trying and log this automatically in a few minutes. No need to resend.",
        });
        return;
      }
      throw finalErr;
    }
  }

  // Barcode → Open Food Facts: for any food the model read a barcode from, look
  // up the exact per-100g nutrition and use it verbatim (tagged `manual` by the
  // resolver). Best-effort — a miss/error leaves the AI estimate untouched.
  const enrichedProvider = await enrichWithBarcodes(analysis, usedProvider);
  usedProvider = enrichedProvider;

  const meal = resolveMeal(analysis);

  // Persist, keeping the Telegram file_id so the photo can be shown later, and
  // the chat + message id of the confirmation so the Mini App / a text revise
  // can edit it in place later.
  const mealsDb = createMealsDb(c.env.DB);
  const foods = meal.foods.map((f) => f.food.name);
  const reply = photoLoggedReply(
    foods,
    {
      energyKcal: meal.total.energyKcal,
      proteinG: meal.total.proteinG,
      carbsG: meal.total.carbsG,
      fatG: meal.total.fatG,
    },
    { miniAppUrl },
  );

  // Edit the "Analyzing…" message into the result (single transforming message).
  // If the edit fails or we never got an id, fall back to sending a new message
  // and use whatever id we end up with as the meal's confirmation reference.
  const confirmMessageId = await replyOrEdit(bot, chatId, job.statusMessageId, reply);

  const mealId = await saveMeal(mealsDb, {
    userId: user.id,
    meal,
    telegramFileId: fileId,
    aiProvider: usedProvider,
    telegramChatId: chatId,
    telegramMessageId: confirmMessageId,
  });
  // (mealId retained for symmetry / future use.)
  void mealId;
}

/**
 * Edits `messageId` in place with `reply` when we have an id and the edit
 * succeeds; otherwise sends a new message. Returns the message id that now holds
 * the content (the edited one, or the newly-sent one), or null if nothing sent.
 */
async function replyOrEdit(
  bot: BotClient,
  chatId: number,
  messageId: number | null | undefined,
  reply: BotReply,
): Promise<number | null> {
  if (messageId != null && bot.editMessageText) {
    const ok = await bot.editMessageText(chatId, messageId, reply);
    if (ok) return messageId;
  }
  const sent = await bot.sendMessage(chatId, reply);
  return sent.messageId;
}
