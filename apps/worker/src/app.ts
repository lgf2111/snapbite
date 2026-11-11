import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createEntitlementMemo, getEntitlement } from './billing/accounts.js';
import type { AppBindings } from './env.js';
import { accountAuth } from './middleware/account.js';
import { telegramAuth } from './middleware/auth.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes, billingWebhookRoutes } from './routes/billing.js';
import { deviceTokenRoutes } from './routes/deviceTokens.js';
import { favoritesRoutes } from './routes/favorites.js';
import { feedbackRoutes } from './routes/feedback.js';
import { type ProviderFactory, mealPhotoRoutes, mealsRoutes } from './routes/meals.js';
import { pushRoutes } from './routes/push.js';
import { settingsRoutes } from './routes/settings.js';
import { shortcutRoutes } from './routes/shortcut.js';
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

  // Credentials matter: the session cookie is HttpOnly and, when the PWA is on a
  // different site than the API, SameSite=None requires an explicit origin.
  app.use(
    '*',
    cors({
      origin: (origin) => origin ?? '*',
      credentials: true,
      allowHeaders: ['content-type', 'authorization', 'x-telegram-init-data'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );

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

  // Operator tools (one-shot broadcast) — guarded by x-admin-token, not an account.
  app.route(
    '/api/admin',
    adminRoutes(opts.botClientFactory ? { botClientFactory: opts.botClientFactory } : {}),
  );

  // Stripe webhook — no SnapBite account; mounted before accountAuth so Stripe's
  // calls cannot create anonymous users. The authenticated billing routes live
  // under `/api/billing` inside the guarded app below.
  app.route('/api/billing', billingWebhookRoutes());

  // Photo proxy — verifies initData via query param (an <img> can't send headers).
  app.route('/api/meal-photo', mealPhotoRoutes(opts.botClientFactory));

  // Sign-in (optional) — unauthenticated by design; it mints a session cookie.
  app.route('/api/auth', authRoutes());

  // Shortcut capture — bearer device token instead of initData. Mounted before
  // the initData-guarded /api app so it wins the match.
  app.route('/api/shortcut', shortcutRoutes(opts.providerFactory));

  // Everything under /api needs an account — but not necessarily Telegram.
  // `accountAuth` resolves initData, a handheld device token, or a session
  // cookie; a request with none of them gets an anonymous account rather than a
  // 401, because signing in is optional.
  const api = new Hono<AppBindings>();
  api.use('*', accountAuth());

  api.get('/me', async (c) => {
    const tgUser = c.get('telegramUser');
    const entitlement = await getEntitlement(c.env.DB, c.get('userId'), createEntitlementMemo());
    return c.json({
      userId: c.get('userId'),
      telegramUserId: tgUser?.id ?? null,
      firstName: tgUser?.first_name ?? null,
      username: tgUser?.username ?? null,
      // True when this browser is authenticated by a session cookie.
      signedIn: c.req.header('cookie')?.includes('sb_session=') ?? false,
      supporter: entitlement.supporter,
      credits: entitlement.credits,
    });
  });

  api.route('/billing', billingRoutes());
  api.route('/settings', settingsRoutes());
  api.route('/meals', mealsRoutes(opts.providerFactory, opts.botClientFactory));
  api.route('/favorites', favoritesRoutes());
  api.route('/account', accountRoutes());
  api.route('/tokens', deviceTokenRoutes());
  api.route('/push', pushRoutes());
  api.route('/feedback', feedbackRoutes(opts.botClientFactory));

  app.route('/api', api);

  return app;
}
