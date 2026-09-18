import { createApp } from './app.js';
import type { Env } from './env.js';
import { runPhotoRetries } from './photoRetry.js';
import { runReminders } from './reminders.js';

const app = createApp();

export default {
  /** HTTP requests (Telegram webhook + Mini App API) are served by the Hono app. */
  fetch: app.fetch,
  /**
   * Cron trigger (see wrangler.toml [triggers].crons): fires meal reminders to
   * users whose local time matches an enabled slot. Best-effort; never throws.
   */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runReminders(env));
    // Re-analyze photos that hit a transient AI overload earlier (§17).
    ctx.waitUntil(runPhotoRetries(env));
  },
};
