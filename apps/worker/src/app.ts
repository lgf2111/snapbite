import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppBindings } from './env.js';
import { telegramAuth } from './middleware/auth.js';
import { accountRoutes } from './routes/account.js';
import { analyticsRoutes } from './routes/analytics.js';
import { mealPhotoRoutes, mealsRoutes, type ProviderFactory, searchRoutes } from './routes/meals.js';
import { settingsRoutes } from './routes/settings.js';
import { type BotClientFactory, webhookRoutes } from './routes/webhook.js';

export interface CreateAppOptions {
  /** Injectable AI provider factory (tests pass a mock). */
  providerFactory?: ProviderFactory;
  /** Injectable Telegram bot client factory (tests pass a mock). */
  botClientFactory?: BotClientFactory;
}

/** Builds the Hono app. Exported separately so tests can mount it directly. */
export function createApp(opts: CreateAppOptions = {}) {
  const app = new Hono<AppBindings>();

  app.use('*', cors());

  // Health check — unauthenticated.
  app.get('/api/health', (c) => c.json({ ok: true }));

  // Telegram webhook — unauthenticated by initData; guarded by secret token.
  app.route(
    '/webhook',
    webhookRoutes({
      ...(opts.botClientFactory ? { botClientFactory: opts.botClientFactory } : {}),
      ...(opts.providerFactory ? { providerFactory: opts.providerFactory } : {}),
    }),
  );

  // Photo proxy — verifies initData via query param (an <img> can't send headers).
  app.route('/api/meal-photo', mealPhotoRoutes(opts.botClientFactory));

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
  api.route('/meals', mealsRoutes(opts.providerFactory, opts.botClientFactory));
  api.route('/search', searchRoutes());
  api.route('/analytics', analyticsRoutes());
  api.route('/account', accountRoutes());

  app.route('/api', api);

  return app;
}
