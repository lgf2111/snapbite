import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppBindings } from './env.js';
import { telegramAuth } from './middleware/auth.js';
import { mealsRoutes, type ProviderFactory } from './routes/meals.js';
import { settingsRoutes } from './routes/settings.js';

export interface CreateAppOptions {
  /** Injectable AI provider factory (tests pass a mock). */
  providerFactory?: ProviderFactory;
}

/** Builds the Hono app. Exported separately so tests can mount it directly. */
export function createApp(opts: CreateAppOptions = {}) {
  const app = new Hono<AppBindings>();

  app.use('*', cors());

  // Health check — unauthenticated.
  app.get('/api/health', (c) => c.json({ ok: true }));

  // Everything under /api (except health) requires a valid Telegram session.
  const api = new Hono<AppBindings>();
  api.use('*', telegramAuth());

  api.get('/me', (c) => {
    const tgUser = c.get('telegramUser');
    return c.json({
      userId: c.get('userId'),
      telegramUserId: tgUser.id,
      firstName: tgUser.first_name ?? null,
      username: tgUser.username ?? null,
    });
  });

  api.route('/settings', settingsRoutes());
  api.route('/meals', mealsRoutes(opts.providerFactory));

  app.route('/api', api);

  return app;
}
