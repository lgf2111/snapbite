/**
 * Sign-in is OPTIONAL.
 *
 * The product works with no account: a browser visitor who never signs in gets
 * an anonymous device session — a signed token in an HttpOnly cookie that
 * identifies one `users` row. Their meals, photos and profile live on that row
 * exactly like a signed-in user's.
 *
 * Email sign-in does one thing only: it attaches a credential to that same row,
 * so the account survives clearing browser data and works on a second device.
 * Nothing is copied, nothing is migrated, and there is no "link your accounts"
 * flow to design.
 */
import { randomToken, sha256Hex } from '../db/auth.js';

const COOKIE_SESSION = 'sb_session';
const COOKIE_DEVICE = 'sb_device';
const SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 days
const DEVICE_TTL_S = 365 * 24 * 60 * 60; // a year, refreshed on use
const COOKIE_PATH = '/';

interface CookieOptions {
  httpOnly: boolean;
  sameSite: 'Lax' | 'None';
  secure: boolean;
  path: string;
  maxAge?: number;
}

/**
 * The Pages site and the Worker are different sites (pages.dev vs workers.dev),
 * so a SameSite=Lax cookie is never sent on cross-site fetches. They differ only
 * by scheme in local dev, where cross-site does not apply.
 */
export function cookieOptions(env: { PAGE_ORIGIN?: string } | undefined, httpOnly: boolean): CookieOptions {
  const crossSite = Boolean(env?.PAGE_ORIGIN);
  return {
    httpOnly,
    sameSite: crossSite ? 'None' : 'Lax',
    secure: crossSite || undefined ? true : false,
    path: COOKIE_PATH,
  };
}

/** Parses a Cookie header into a plain map (no dependency needed). */
export function readCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key) out[key] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function serialise(name: string, value: string, opts: CookieOptions, maxAge?: number): string {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path}`,
    `SameSite=${opts.sameSite}`,
  ];
  if (opts.httpOnly) bits.push('HttpOnly');
  if (opts.secure) bits.push('Secure');
  if (maxAge !== undefined) bits.push(`Max-Age=${maxAge}`);
  return bits.join('; ');
}

export const cookies = {
  session: COOKIE_SESSION,
  device: COOKIE_DEVICE,
  sessionMaxAge: SESSION_TTL_S,
  deviceMaxAge: DEVICE_TTL_S,
  serialise,
};

/* ---------------- device (anonymous) tokens ---------------- */

/** `dev_<random>`; the row stores only its hash. */
export function mintDeviceToken(): string {
  return `dev_${randomToken(32)}`;
}

export const hashDeviceToken = sha256Hex;

/** Stable per-device key so we can find the account without a DB scan. */
export async function deviceLookupHash(raw: string): Promise<string> {
  return sha256Hex(`device:${raw}`);
}
