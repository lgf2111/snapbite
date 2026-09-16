import { z } from 'zod';

/**
 * The Telegram user embedded in initData (subset we care about).
 * See https://core.telegram.org/bots/webapps#webappuser
 */
export const TelegramUser = z.object({
  id: z.number().int(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
  is_premium: z.boolean().optional(),
});
export type TelegramUser = z.infer<typeof TelegramUser>;

/** Parsed, verified initData. */
export interface VerifiedInitData {
  user: TelegramUser;
  authDate: Date;
  /** Raw fields, for anything else the caller needs. */
  raw: Record<string, string>;
}

export type InitDataFailure =
  | 'missing_hash'
  | 'bad_hash'
  | 'expired'
  | 'missing_user'
  | 'malformed';

export type InitDataResult =
  | { ok: true; data: VerifiedInitData }
  | { ok: false; reason: InitDataFailure };

export interface VerifyInitDataOptions {
  /** Max age of auth_date before it's considered expired. Default 24h. */
  maxAgeSeconds?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

const encoder = new TextEncoder();

/** Constant-time comparison of two hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const keyData = key instanceof Uint8Array ? key : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

/**
 * Verifies a Telegram Mini App `initData` query string against the bot token,
 * following the documented algorithm:
 *
 * 1. Parse the query string into key/value pairs; pull out `hash`.
 * 2. Build the data-check-string: `key=value` lines sorted by key, joined by \n.
 * 3. secret_key = HMAC_SHA256(key="WebAppData", data=bot_token).
 * 4. computed = HMAC_SHA256(key=secret_key, data=data-check-string), hex.
 * 5. Constant-time compare computed vs the provided hash.
 * 6. Enforce auth_date freshness and a valid user.
 *
 * Pure and platform-agnostic (WebCrypto), so it runs in Workers and Node.
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  opts: VerifyInitDataOptions = {},
): Promise<InitDataResult> {
  const maxAgeSeconds = opts.maxAgeSeconds ?? 24 * 60 * 60;
  const now = opts.now ?? Date.now;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing_hash' };

  const pairs: string[] = [];
  const raw: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    raw[key] = value;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken);
  const computed = toHex(await hmacSha256(secretKey, dataCheckString));

  if (!timingSafeEqualHex(computed, hash.toLowerCase())) {
    return { ok: false, reason: 'bad_hash' };
  }

  const authDateRaw = raw.auth_date;
  if (authDateRaw) {
    const authDateSec = Number(authDateRaw);
    if (Number.isFinite(authDateSec)) {
      const ageSeconds = now() / 1000 - authDateSec;
      if (ageSeconds > maxAgeSeconds) return { ok: false, reason: 'expired' };
    }
  }

  if (!raw.user) return { ok: false, reason: 'missing_user' };
  let userJson: unknown;
  try {
    userJson = JSON.parse(raw.user);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const parsedUser = TelegramUser.safeParse(userJson);
  if (!parsedUser.success) return { ok: false, reason: 'missing_user' };

  const authDate = authDateRaw ? new Date(Number(authDateRaw) * 1000) : new Date(now());
  return { ok: true, data: { user: parsedUser.data, authDate, raw } };
}

/**
 * Test/tooling helper: signs a set of fields into a valid initData query string
 * for the given bot token. Not used in production request paths.
 */
export async function signInitData(
  fields: Record<string, string>,
  botToken: string,
): Promise<string> {
  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const dataCheckString = pairs.join('\n');
  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken);
  const hash = toHex(await hmacSha256(secretKey, dataCheckString));

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, v);
  params.set('hash', hash);
  return params.toString();
}
