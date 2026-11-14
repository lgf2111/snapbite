import { type Context, Hono } from 'hono';
import { cookies, deviceLookupHash, mintDeviceToken, readCookies } from '../auth/cookies.js';
import {
  google,
  newState,
  oauthStateCookie,
  publicOrigin,
  redirectUriFor,
} from '../auth/social.js';
import { grantTrial } from '../billing/accounts.js';
import {
  type AuthDb,
  attachEmailToUser,
  createAuthDb,
  createSession,
  deleteSession,
  findOrCreateDeviceUser,
  findSession,
  findUserByEmail,
  normalizeEmail,
  orphanTelegramAccounts,
} from '../db/auth.js';
import type { AppBindings } from '../env.js';

/**
 * Grants the one-time registration trial to a verified email. Best-effort on
 * purpose: a billing-table problem must never block a valid sign-in.
 */
async function grantSignInTrial(db: D1Database, email: string): Promise<void> {
  try {
    await grantTrial(db, email);
  } catch (err) {
    console.warn('[auth] trial grant failed', err);
  }
}

/**
 * Auth routes. Sign-in is optional; these only exist so a person can attach a
 * Google identity to the account they already have, or open it on a new device.
 *
 *   POST /api/auth/logout             -> clears the session cookie
 *   GET  /api/auth/me                 -> { signedIn, email, userId }
 *
 * All of them are unauthenticated on purpose: a session is optional everywhere
 * else, so there is nothing to guard.
 */
export function authRoutes() {
  const app = new Hono<AppBindings>();

  const db = (c: Context<AppBindings>): AuthDb => createAuthDb(c.env.DB);

  /** The account behind this request, if any (session first, then device). */
  async function currentUser(c: Context<AppBindings>) {
    const jar = readCookies(c.req.header('cookie'));
    const session = await findSession(db(c), jar[cookies.session] ?? '');
    if (session) return { user: session.user, via: 'session' as const, method: session.method };
    return { user: null, via: null, method: null };
  }

  /** Which sign-in methods this deployment can actually offer. */
  app.get('/providers', (c) => {
    return c.json({ google: google.configured(c.env) });
  });

  /**
   * Starts Google sign-in. `?next=` is where to send the browser afterwards; it
   * must be same-origin with APP_ORIGIN, so this cannot be used as an open
   * redirect.
   */
  app.get('/start/google', (c) => {
    if (!google.configured(c.env)) {
      return c.json({ error: 'Not configured', detail: 'Google sign-in is not enabled' }, 400);
    }
    const state = newState();
    const apiOrigin = publicOrigin(c.env, c.req.raw.headers, c.req.url);
    const redirectUri = redirectUriFor(apiOrigin);

    const jar = readCookies(c.req.header('cookie'));
    const crossSite = Boolean(c.env.PAGE_ORIGIN);
    // State cookie rides the redirect back from Google (a cross-site GET), so it
    // needs the same posture as the session cookie.
    const stateCookie = cookies.serialise(
      oauthStateCookie.name,
      state,
      { httpOnly: true, sameSite: crossSite ? 'None' : 'Lax', secure: crossSite, path: '/' },
      oauthStateCookie.maxAge,
    );
    c.header('set-cookie', stateCookie);

    return c.redirect(google.authorizeUrl(c.env, { state, redirectUri }), 302);
  });

  /**
   * Google's callback. Verifies state, exchanges the code, then resolves the
   * account by the verified email — the join key — and issues a session cookie
   * before bouncing back to the app.
   */
  app.get('/callback/google', async (c) => {
    const appOrigin = c.env.APP_ORIGIN ?? new URL(c.req.url).origin;
    const code = c.req.query('code') ?? '';
    const state = c.req.query('state') ?? '';
    const jar = readCookies(c.req.header('cookie'));
    const expected = jar[oauthStateCookie.name] ?? '';

    if (!code || !state || state !== expected) {
      return c.redirect(`${appOrigin}/?auth=state`, 302);
    }

    // Must be the very string /start/google sent, or Google refuses the code.
    const apiOrigin = publicOrigin(c.env, c.req.raw.headers, c.req.url);
    const profile = await google.exchange(c.env, { code, redirectUri: redirectUriFor(apiOrigin) });
    if (!profile) return c.redirect(`${appOrigin}/?auth=error`, 302);
    if (!profile.emailVerified) return c.redirect(`${appOrigin}/?auth=unverified`, 302);

    const email = normalizeEmail(profile.email);
    const authDb = createAuthDb(c.env.DB);

    // 1. Email is the join key: an account that already owns it wins.
    const owner = await findUserByEmail(authDb, email);
    let userId: string | null = owner?.id ?? null;

    // 2. Otherwise adopt this browser's anonymous account, so nothing is lost.
    if (!userId) {
      let deviceRaw = jar[cookies.device] ?? '';
      if (!deviceRaw) deviceRaw = mintDeviceToken();
      const { user, created } = await findOrCreateDeviceUser(
        authDb,
        await deviceLookupHash(deviceRaw),
      );
      if (!user) return c.redirect(`${appOrigin}/?auth=error`, 302);
      const attached = await attachEmailToUser(authDb, user.id, email);
      if (!attached.ok) return c.redirect(`${appOrigin}/?auth=conflict`, 302);
      userId = user.id;

      // A brand-new account while Telegram accounts sit with meals and no email:
      // one of them may be this person's real account, orphaned by a restore. We
      // cannot tell which (nothing links them) and refusing every new sign-up
      // for that would be worse, so say so where an operator will see it.
      if (created) {
        const orphans = await orphanTelegramAccounts(c.env.DB);
        if (orphans.length > 0) {
          console.warn(
            `[auth] new Google account ${user.id} (${email}) while ${orphans.length} Telegram account(s) have meals and no email; merge with scripts/merge-users.sql if one is theirs:`,
            JSON.stringify(orphans),
          );
          c.header('x-snapbite-orphan-candidates', String(orphans.length));
        }
      }
    }

    // Verified identity: grant the once-per-email trial before the session.
    await grantSignInTrial(c.env.DB, email);

    const sessionRaw = await createSession(authDb, userId, 'google');
    const opts = cookieOptionsFor(c);
    c.header(
      'set-cookie',
      cookies.serialise(cookies.session, sessionRaw, opts, cookies.sessionMaxAge),
    );
    return c.redirect(`${appOrigin}/?auth=ok`, 302);
  });

  app.get('/me', async (c) => {
    const { user, via, method } = await currentUser(c);
    if (!user) {
      return c.json({ signedIn: false, via: null, method: null, email: null, userId: null });
    }
    return c.json({
      signedIn: via === 'session',
      via,
      // 'google', or 'email' for sessions opened before email sign-in was removed;
      // null for sessions older than the column itself.
      method,
      email: user.email ?? null,
      userId: user.id,
      telegramLinked: user.telegramUserId != null,
    });
  });

  app.post('/logout', async (c) => {
    const jar = readCookies(c.req.header('cookie'));
    await deleteSession(db(c), jar[cookies.session] ?? '');
    const opts = cookieOptionsFor(c);
    c.header('set-cookie', cookies.serialise(cookies.session, '', opts, 0));
    return c.json({ ok: true });
  });

  function cookieOptionsFor(c: Context<AppBindings>) {
    const crossSite = Boolean(c.env.PAGE_ORIGIN);
    return {
      httpOnly: true,
      sameSite: (crossSite ? 'None' : 'Lax') as 'None' | 'Lax',
      secure: crossSite,
      path: '/',
    };
  }

  return app;
}
