import { env } from 'cloudflare:test';
import { vi } from 'vitest';
import type { createApp } from '../app.js';

/** The env the Google routes need; the test config has no OAuth client. */
export const GOOGLE_ENV = {
  ...env,
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'secret',
  APP_ORIGIN: 'https://app.test',
};

function cookieOf(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null;
  for (const part of setCookie.split(/,(?=[^;]+=)/)) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.split(';')[0] ?? null;
  }
  return null;
}

/**
 * Completes a real Google callback: starts the flow to get its state cookie,
 * stubs the token exchange with an id_token carrying verified claims, then
 * returns the session cookie the callback sets. Google is the only sign-in path.
 *
 * Call `vi.unstubAllGlobals()` in afterEach.
 */
export async function googleSignIn(
  app: ReturnType<typeof createApp>,
  email: string,
): Promise<{ cookie: string; setCookie: string }> {
  const start = await app.request('/api/auth/start/google', {}, GOOGLE_ENV);
  const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
  const stateCookie = cookieOf(start.headers.get('set-cookie'), 'sb_oauth_state');
  if (!state || !stateCookie) throw new Error('Google sign-in did not start');

  // The exchange trusts a token fetched from Google over TLS, so a stand-in
  // response with the right audience and issuer is enough for the callback.
  const payload = btoa(
    JSON.stringify({
      email,
      email_verified: true,
      sub: `sub-${email}`,
      aud: 'client-id',
      iss: 'https://accounts.google.com',
    }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ id_token: `e30.${payload}.sig` })),
  );

  const callback = await app.request(
    `/api/auth/callback/google?code=code&state=${encodeURIComponent(state)}`,
    { headers: { cookie: stateCookie } },
    GOOGLE_ENV,
  );
  const setCookie = callback.headers.get('set-cookie') ?? '';
  const cookie = cookieOf(setCookie, 'sb_session');
  if (!cookie) throw new Error('Google sign-in did not set a session');
  return { cookie, setCookie };
}
