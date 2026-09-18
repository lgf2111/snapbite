import type { TelegramUser } from '@foodlog/core';

/** Cloudflare bindings + secrets available to the Worker. */
export interface Env {
  /** D1 database binding (configured in wrangler.toml). */
  DB: D1Database;
  /** Telegram bot token — verifies initData and sends bot messages. */
  TELEGRAM_BOT_TOKEN: string;
  /** AES-GCM master key (base64) for BYOK encryption. Used from Task 7. */
  ENCRYPTION_KEY?: string;
  /** HTTPS URL of the deployed Mini App, for the web_app launch button. */
  MINI_APP_URL?: string;
  /** Shared secret Telegram echoes in X-Telegram-Bot-Api-Secret-Token on webhooks. */
  TELEGRAM_WEBHOOK_SECRET?: string;
  /**
   * The owner's Telegram numeric user id. Gates admin bot commands (/errors,
   * /feedback review) and is the DM target for error/feedback alerts. Optional:
   * when unset, error DMs + admin commands are simply disabled (storage still
   * works). Stored as a string secret; parse with `parseAdminId`.
   */
  ADMIN_TELEGRAM_ID?: string;
  /**
   * Optional admin GROUP chat id (a negative supergroup id, e.g. -1003990101342).
   * When set, admin alerts (errors/feedback/broadcast) post into this group's
   * Topics instead of DMing `ADMIN_TELEGRAM_ID`. Group-only when configured.
   */
  ADMIN_GROUP_CHAT_ID?: string;
  /** Forum Topic (message_thread_id) for error alerts in the admin group. */
  ERRORS_THREAD_ID?: string;
  /** Forum Topic for user feedback in the admin group. */
  FEEDBACK_THREAD_ID?: string;
  /** Forum Topic for broadcast records in the admin group. */
  BROADCAST_THREAD_ID?: string;
}

/** Parses ADMIN_TELEGRAM_ID into a positive number, or null when unset/invalid. */
export function parseAdminId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Parses a chat id that may be NEGATIVE (Telegram supergroup/channel ids are
 * negative, e.g. -1003990101342). Returns null when unset/invalid or zero.
 */
export function parseChatId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** Parses a positive Topic thread id, or null. */
export function parseThreadId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Variables attached to the Hono context after auth. */
export interface Variables {
  telegramUser: TelegramUser;
  /** The resolved application user id (row id in `users`). */
  userId: string;
}

export type AppBindings = { Bindings: Env; Variables: Variables };
