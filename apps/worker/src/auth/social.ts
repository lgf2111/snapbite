/**
 * Social sign-in: Google (OAuth 2.0 / OpenID Connect).
 *
 * Deliberately dependency-free — two fetches (authorize redirect, token exchange)
 * and one JWT payload decode. Google's `id_token` is trusted only after it has
 * been fetched directly from Google's token endpoint over TLS with our client
 * secret, so signature verification is unnecessary (OAuth 2.0 spec, §3.1.3.7).
 *
 * The email from the provider is the join key, so a Google account lands on the
 * account that already owns that address.
 */
import type { AppBindings } from '../env.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const STATE_COOKIE = 'sb_oauth_state';
const STATE_TTL_S = 10 * 60;

export interface SocialProvider {
  id: 'google';
  configured(env: AppBindings['Bindings']): boolean;
  /** Where to send the browser to start the flow. */
  authorizeUrl(env: AppBindings['Bindings'], opts: { state: string; redirectUri: string }): string;
  /** Exchanges the code and returns the verified email + provider subject. */
  exchange(
    env: AppBindings['Bindings'],
    opts: { code: string; redirectUri: string },
  ): Promise<{ email: string; subject: string; emailVerified: boolean } | null>;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Google's console copies cleanly, but a value pasted from a chat, a doc or a
 * screenshot often carries smart quotes or newlines. A stray quote turns into
 * `invalid_client` at the authorize step, which looks like a code bug. Strip
 * decorative quoting and whitespace before use.
 */
export function cleanCredential(value: string | undefined): string {
  if (!value) return '';
  return value
    .trim()
    .replace(/^[\s"'`\u2018\u2019\u201C\u201D]+/, '')
    .replace(/[\s"'`\u2018\u2019\u201C\u201D]+$/, '')
    .trim();
}

export const google: SocialProvider = {
  id: 'google',

  configured(env) {
    return Boolean(
      cleanCredential(env.GOOGLE_CLIENT_ID) && cleanCredential(env.GOOGLE_CLIENT_SECRET),
    );
  },

  authorizeUrl(env, { state, redirectUri }) {
    const params = new URLSearchParams({
      client_id: cleanCredential(env.GOOGLE_CLIENT_ID),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
      // No offline access: we never call Google again after sign-in.
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchange(env, { code, redirectUri }) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cleanCredential(env.GOOGLE_CLIENT_ID),
        client_secret: cleanCredential(env.GOOGLE_CLIENT_SECRET),
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) return null;

    const body = (await res.json()) as { id_token?: string };
    const claims = body.id_token ? decodeJwtPayload(body.id_token) : null;
    if (!claims) return null;

    const email = typeof claims.email === 'string' ? claims.email : '';
    const subject = typeof claims.sub === 'string' ? claims.sub : '';
    if (!email || !subject) return null;

    // Reject anything minted for a different audience or not from Google.
    if (claims.aud !== cleanCredential(env.GOOGLE_CLIENT_ID)) return null;
    if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
      return null;
    }

    return { email, subject, emailVerified: claims.email_verified === true };
  },
};

/** Random, unguessable state value (CSRF protection for the OAuth round trip). */
export function newState(): string {
  const buf = crypto.getRandomValues(new Uint8Array(16));
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const oauthStateCookie = {
  name: STATE_COOKIE,
  maxAge: STATE_TTL_S,
};

/**
 * The origin the browser actually used.
 *
 * The app reaches this Worker through a Pages Function proxy on its own domain
 * (so the session cookie is first-party). Behind that proxy the request URL is
 * the workers.dev host, and the proxy reports what the browser saw in
 * `x-forwarded-host` / `x-forwarded-proto`. Those headers are believed only when
 * they spell exactly APP_ORIGIN: anyone can send them, and trusting an arbitrary
 * value would let a caller choose where Google redirects back to.
 */
export function publicOrigin(
  env: { APP_ORIGIN?: string },
  headers: { get(name: string): string | null },
  requestUrl: string,
): string {
  const own = new URL(requestUrl).origin;
  const host = headers.get('x-forwarded-host');
  if (!host || !env.APP_ORIGIN) return own;
  let app: string;
  try {
    app = new URL(env.APP_ORIGIN).origin;
  } catch {
    return own;
  }
  const proto = headers.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}` === app ? app : own;
}

/** The callback URL Google must call back; must match the console exactly. */
export function redirectUriFor(apiOrigin: string): string {
  return `${apiOrigin}/api/auth/callback/google`;
}
