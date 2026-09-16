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
}

/** Variables attached to the Hono context after auth. */
export interface Variables {
  telegramUser: TelegramUser;
  /** The resolved application user id (row id in `users`). */
  userId: string;
}

export type AppBindings = { Bindings: Env; Variables: Variables };
