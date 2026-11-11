import type { TelegramUser } from '@snapbite/core';

/** Cloudflare bindings + secrets available to the Worker. */
export interface Env {
  /** D1 database binding (configured in wrangler.toml). */
  DB: D1Database;
  /** R2 bucket holding meal photo bytes. Optional: without it no photos are stored. */
  PHOTOS?: R2Bucket;
  /** Telegram bot token — verifies initData and sends bot messages. */
  TELEGRAM_BOT_TOKEN: string;
  /** AES-GCM master key (base64) for BYOK encryption. Used from Task 7. */
  ENCRYPTION_KEY?: string;
  /**
   * The owner's hosted Gemini key. Used only when a signed-in account buys or
   * trials credits; BYOK users never touch it. Unset => the paid path degrades
   * to a typed refusal instead of a broken call.
   */
  GEMINI_API_KEY?: string;
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
   * Shared secret for the operator endpoint (`POST /api/admin/broadcast`), sent as
   * `x-admin-token`. Unset => the endpoint answers 503 and does nothing.
   */
  ADMIN_TOKEN?: string;
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
  /**
   * Local development only: '1' makes /api/auth/login hand the magic link back in
   * the response when no email can be sent. Never set it in production: the link
   * signs in as whatever address was typed.
   */
  DEV_LOGIN_LINKS?: string;
  /** Resend API key for sign-in emails. Unset => no email is sent (and no link is returned). */
  RESEND_API_KEY?: string;
  /** From address for sign-in emails, e.g. "SnapBite <login@example.com>". */
  EMAIL_FROM?: string;
  /** Public origin of the app, used to build magic links. */
  APP_ORIGIN?: string;
  /** Web push (VAPID): the public key, base64url, a 65-byte uncompressed P-256 point. */
  PUSH_VAPID_PUBLIC_KEY?: string;
  /** Web push (VAPID): the private scalar, base64url, 32 bytes. A secret. */
  PUSH_VAPID_PRIVATE_KEY?: string;
  /** Web push (VAPID) contact, e.g. `mailto:you@example.com`. */
  PUSH_VAPID_SUBJECT?: string;
  /** Google OAuth client id (sign-in with Google). */
  GOOGLE_CLIENT_ID?: string;
  /** Google OAuth client secret. */
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * Origin of the Pages site when it differs from the Worker's (the PWA case).
   * Set => session cookies must be SameSite=None; Secure for cross-site sends.
   */
  PAGE_ORIGIN?: string;
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
  /** Null for email/device accounts that never touched the bot. */
  telegramUser: TelegramUser | null;
  /** The resolved application user id (row id in `users`). */
  userId: string;
}

export type AppBindings = { Bindings: Env; Variables: Variables };
