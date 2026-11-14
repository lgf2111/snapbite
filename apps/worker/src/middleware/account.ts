import type { MiddlewareHandler } from 'hono';
import { cookies, deviceLookupHash, mintDeviceToken, readCookies } from '../auth/cookies.js';
import { createAuthDb, findOrCreateDeviceUser, findSessionUser } from '../db/auth.js';
import { resolveDeviceToken } from '../db/deviceTokens.js';
import { createDb, upsertUser } from '../db/users.js';
import type { AppBindings } from '../env.js';
import { INIT_DATA_HEADER } from './auth.js';

/**
 * Resolves the account behind a request, in this order:
 *
 *   1. Telegram `initData` (header or query) — the Mini App and the Shortcut.
 *   2. `Authorization: Bearer sb_…` — a handheld device token (Shortcut).
 *   3. Session cookie — a Google sign-in.
 *   4. Device cookie — an anonymous account, created on first sight.
 *
 * Signing in is optional, so step 4 means a plain browser gets a working account
 * instead of a 401. Only a *bad* credential (a malformed or revoked bearer
 * token) is rejected outright, because silently downgrading it to anonymous
 * would file the user's meals under a new account.
 */
export function accountAuth(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const bearer = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    const queryToken = c.req.query('token') ?? '';
    const rawToken = (bearer || queryToken).replace(/\s+/g, '');

    // 2. Handheld bearer token.
    //
    // Two hashes exist on purpose and must not be unified:
    //   - `deviceLookupHash` (this path) salts with "device:" and resolves a
    //     cookie-backed device credential.
    //   - `hashDeviceToken` (the Shortcut path) is the plain SHA-256 stored for
    //     `sb_…` tokens.
    // Because they differ, an iOS Shortcut token can log meals through
    // /api/shortcut and nothing else: it cannot read the account, mint another
    // token, or revoke anything. Verified against production: an sb_ token gets
    // 401 on /api/me and 401 from POST /api/tokens. If someone ever makes these
    // two agree, /api/* becomes reachable with a token that sits in a Shortcut.
    if (rawToken) {
      const resolved = await resolveDeviceToken(
        createAuthDb(c.env.DB) as never,
        await deviceLookupHash(rawToken).catch(() => ''),
      );
      if (!resolved) {
        return c.json({ error: 'Unauthorized', detail: 'Device token is invalid or revoked' }, 401);
      }
      c.set('userId', resolved.userId);
      c.set('telegramUser', null);
      await next();
      return;
    }

    // 1. Telegram initData.
    const initData =
      c.req.header(INIT_DATA_HEADER) ?? new URL(c.req.url).searchParams.get('initData') ?? '';
    if (initData) {
      const { verifyInitData } = await import('@snapbite/core');
      if (!c.env.TELEGRAM_BOT_TOKEN) {
        return c.json({ error: 'Server misconfigured', detail: 'No bot token' }, 500);
      }
      const verified = await verifyInitData(initData, c.env.TELEGRAM_BOT_TOKEN);
      if (verified.ok) {
        const user = await upsertUser(createDb(c.env.DB), verified.data.user);
        c.set('telegramUser', verified.data.user);
        c.set('userId', user.id);
        await next();
        return;
      }
      // Fall through: a stale initData on a browser request must not kill the
      // request when an account cookie is present.
    }

    const jar = readCookies(c.req.header('cookie'));
    const authDb = createAuthDb(c.env.DB);

    // 3. Email session.
    const sessionUser = await findSessionUser(authDb, jar[cookies.session] ?? '');
    if (sessionUser) {
      c.set('userId', sessionUser.id);
      c.set('telegramUser', null);
      await next();
      return;
    }

    // 4. Anonymous device account — created once, then reused.
    let deviceRaw = jar[cookies.device] ?? '';
    const isNewDevice = !deviceRaw;
    if (isNewDevice) deviceRaw = mintDeviceToken();
    const { user } = await findOrCreateDeviceUser(authDb, await deviceLookupHash(deviceRaw));
    if (!user) return c.json({ error: 'Server error', detail: 'Could not open a session' }, 500);

    if (isNewDevice) {
      const crossSite = Boolean(c.env.PAGE_ORIGIN);
      c.header(
        'set-cookie',
        cookies.serialise(
          cookies.device,
          deviceRaw,
          { httpOnly: true, sameSite: crossSite ? 'None' : 'Lax', secure: crossSite, path: '/' },
          cookies.deviceMaxAge,
        ),
        { append: true },
      );
    }

    c.set('userId', user.id);
    c.set('telegramUser', null);
    await next();
  };
}
