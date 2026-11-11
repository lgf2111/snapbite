import { type Context, Hono } from 'hono';
import {
  cookies,
  deviceLookupHash,
  hashDeviceToken,
  mintDeviceToken,
  readCookies,
} from '../auth/cookies.js';
import { google, newState, oauthStateCookie, redirectUriFor } from '../auth/social.js';
import {
  type AuthDb,
  attachEmailToUser,
  consumeLoginToken,
  createAuthDb,
  createSession,
  deleteSession,
  findOrCreateDeviceUser,
  findSession,
  findUserByEmail,
  issueLoginToken,
  looksLikeEmail,
  normalizeEmail,
} from '../db/auth.js';
import type { AppBindings } from '../env.js';

/** A magic link is useless without somewhere to send it. */
function canSendEmail(env: AppBindings['Bindings']): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM && env.APP_ORIGIN);
}

/**
 * Emails a magic link through Resend's HTTP API (no SDK, one fetch).
 * Returns false when delivery is not configured or the API rejects it, so the
 * caller can answer honestly instead of pretending.
 */
async function sendMagicLink(
  env: AppBindings['Bindings'],
  to: string,
  link: string,
): Promise<boolean> {
  if (!canSendEmail(env)) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to,
        subject: 'Your SnapBite sign-in link',
        text: `Tap to sign in to SnapBite (valid for 15 minutes):\n\n${link}\n\nIf you didn't ask for this, ignore this email.`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Auth routes. Sign-in is optional; these only exist so a person can attach an
 * email credential to the account they already have, or open it on a new device.
 *
 *   POST /api/auth/login   { email }  -> { ok, delivered, link? }
 *   GET  /api/auth/verify?token=...   -> sets the session cookie, redirects
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
    return c.json({
      email: canSendEmail(c.env),
      google: google.configured(c.env),
    });
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
    const apiOrigin = new URL(c.req.url).origin;
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
   * account by email — the same join key the magic link uses — and issues a
   * session cookie before bouncing back to the app.
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

    const apiOrigin = new URL(c.req.url).origin;
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
      const { user } = await findOrCreateDeviceUser(authDb, await deviceLookupHash(deviceRaw));
      if (!user) return c.redirect(`${appOrigin}/?auth=error`, 302);
      const attached = await attachEmailToUser(authDb, user.id, email);
      if (!attached.ok) return c.redirect(`${appOrigin}/?auth=conflict`, 302);
      userId = user.id;
    }

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
      // 'google' | 'email' | null (null for sessions opened before it was recorded).
      method,
      email: user.email ?? null,
      userId: user.id,
      telegramLinked: user.telegramUserId != null,
    });
  });

  app.post('/login', async (c) => {
    let email = '';
    try {
      const body = (await c.req.json()) as { email?: unknown };
      email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    } catch {
      return c.json({ error: 'Bad request', detail: 'Invalid JSON' }, 400);
    }
    if (!looksLikeEmail(email)) {
      return c.json({ error: 'Bad request', detail: 'Enter a valid email address' }, 400);
    }

    const token = await issueLoginToken(db(c), email);
    const base = c.env.APP_ORIGIN ?? new URL(c.req.url).origin;
    // Lands on the app so the browser ends up signed in *there*, not on the API origin.
    const link = `${base}/verify?token=${encodeURIComponent(token)}`;

    const delivered = await sendMagicLink(c.env, email, link);
    // Not configured (or Resend failed): hand the link straight back so the flow
    // is testable from a phone. Never do this once email works in production.
    const devLink = delivered ? undefined : link;

    // Same answer whether or not the address has an account — no enumeration.
    return c.json({ ok: true, delivered, ...(devLink ? { link: devLink } : {}) });
  });

  app.get('/verify', async (c) => {
    const raw = c.req.query('token') ?? '';
    const email = await consumeLoginToken(db(c), raw);
    const appOrigin = c.env.APP_ORIGIN ?? new URL(c.req.url).origin;

    if (!email) {
      return c.redirect(`${appOrigin}/?auth=expired`, 302);
    }

    // Prefer the account this browser already uses, so an anonymous visitor's
    // meals stay with them after signing in.
    const jar = readCookies(c.req.header('cookie'));
    let userId: string | null = null;
    const deviceRaw = jar[cookies.device] ?? '';

    const existingOwner = await findUserByEmail(db(c), email);
    if (!existingOwner && deviceRaw) {
      // No account owns this address yet -> adopt this browser's account.
      const deviceHash = await deviceLookupHash(deviceRaw);
      const { user } = await findOrCreateDeviceUser(db(c), deviceHash);
      if (user) {
        const attached = await attachEmailToUser(db(c), user.id, email);
        if (attached.ok) userId = user.id;
      }
    }

    // Email is the join key: if this address already owns an account (e.g. one
    // created by the bot), sign in to THAT row so its meals show up here.
    if (!userId) {
      const owner = await findUserByEmail(db(c), email);
      if (owner) userId = owner.id;
    }

    // Nothing owns it and this browser has no account to adopt: make one.
    if (!userId) {
      const deviceHash = await deviceLookupHash(mintDeviceToken());
      const { user } = await findOrCreateDeviceUser(db(c), deviceHash);
      if (!user) return c.redirect(`${appOrigin}/?auth=error`, 302);
      const attached = await attachEmailToUser(db(c), user.id, email);
      if (!attached.ok) return c.redirect(`${appOrigin}/?auth=conflict`, 302);
      userId = user.id;
    }

    const sessionRaw = await createSession(db(c), userId, 'email');
    const opts = cookieOptionsFor(c);
    c.header(
      'set-cookie',
      cookies.serialise(cookies.session, sessionRaw, opts, cookies.sessionMaxAge),
    );
    return c.redirect(`${appOrigin}/?auth=ok`, 302);
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

  // Kept for the device-token helpers used above.
  void hashDeviceToken;
  void createSession;

  return app;
}
