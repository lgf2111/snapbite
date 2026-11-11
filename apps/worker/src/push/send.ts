/**
 * Web push, by hand.
 *
 * No library: a push is a VAPID-signed (RFC 8292) POST of an aes128gcm-encrypted
 * (RFC 8291) body to the endpoint the browser gave us. Everything here is plain
 * WebCrypto, so it runs in the Worker and in tests unchanged.
 *
 * iOS shows nothing for an unencrypted or wrongly encrypted body, and there is
 * no error you can read, so the cipher is covered by a round-trip test that
 * decrypts with the receiving side's private key.
 */
import type { Env } from '../env.js';

const encoder = new TextEncoder();

/* ---------------- base64url ---------------- */

export function b64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/* ---------------- VAPID (RFC 8292) ---------------- */

export interface VapidKeys {
  /** base64url, 65-byte uncompressed P-256 point. */
  publicKey: string;
  /** base64url, 32-byte scalar. */
  privateKey: string;
  /** `mailto:` or https URL the push service can contact. */
  subject: string;
}

/**
 * The ES256 JWT that proves we are the application server this subscription was
 * made for. WebCrypto's ECDSA already returns the signature as the 64-byte
 * r||s that JWS wants (not DER), so no conversion is needed.
 */
export async function vapidJwt(
  endpoint: string,
  keys: VapidKeys,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const pub = b64urlDecode(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('VAPID public key must be 65 bytes');
  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: b64urlEncode(pub.slice(1, 33)),
      y: b64urlEncode(pub.slice(33, 65)),
      d: keys.privateKey,
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const header = b64urlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64urlEncode(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: nowSeconds + 12 * 60 * 60,
        sub: keys.subject,
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(signingInput)),
  );
  return `${signingInput}.${b64urlEncode(signature)}`;
}

/* ---------------- payload encryption (RFC 8291, aes128gcm) ---------------- */

/** Record size we declare. One record carries any payload we send (a few hundred bytes). */
const RECORD_SIZE = 4096;

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  bytes: number,
): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    base,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Encrypt `plaintext` for a subscription's `p256dh` (65-byte point) and `auth`
 * (16-byte secret). Returns the whole request body: salt(16) | rs(4) | idlen(1)
 * | keyid(65, our ephemeral public key) | ciphertext.
 *
 * `salt` and `ephemeral` are injectable so a test can reproduce a vector.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  p256dhB64: string,
  authB64: string,
  opts: { salt?: Uint8Array; ephemeral?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(p256dhB64);
  const authSecret = b64urlDecode(authB64);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error('bad p256dh');
  if (authSecret.length !== 16) throw new Error('bad auth secret');

  const ephemeral =
    opts.ephemeral ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair);
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', ephemeral.publicKey)) as ArrayBuffer,
  );

  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits(
      // workers-types spells the peer key `$public`; the runtime property is `public`.
      { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      ephemeral.privateKey,
      256,
    ),
  );

  // Stage 1: the shared secret, mixed with the subscription's auth secret.
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);

  // Stage 2: the content-encryption key and nonce, salted per message.
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  // One record: the payload, then the 0x02 "last record" delimiter.
  const record = concat(plaintext, new Uint8Array([0x02]));
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, record),
  );

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/* ---------------- sending ---------------- */

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushResult {
  ok: boolean;
  /** HTTP status from the push service; 0 when we never got that far. */
  status: number;
}

/** The push service says this subscription no longer exists. */
export const isGone = (r: PushResult): boolean => r.status === 404 || r.status === 410;

function vapidFromEnv(
  env: Pick<Env, 'PUSH_VAPID_PUBLIC_KEY' | 'PUSH_VAPID_PRIVATE_KEY' | 'PUSH_VAPID_SUBJECT'>,
): VapidKeys | null {
  const { PUSH_VAPID_PUBLIC_KEY: publicKey, PUSH_VAPID_PRIVATE_KEY: privateKey } = env;
  if (!publicKey || !privateKey) return null;
  return {
    publicKey: publicKey.trim(),
    privateKey: privateKey.trim(),
    subject: env.PUSH_VAPID_SUBJECT?.trim() || 'mailto:admin@example.com',
  };
}

/**
 * Send one notification. Never throws: a bad key, a network error or a refusal
 * all come back as `{ ok: false, status }`. A 404 or 410 means the subscription
 * is dead and should be deleted.
 */
export async function sendPush(
  subscription: PushSubscriptionKeys,
  payload: Record<string, unknown> | string,
  env: Pick<Env, 'PUSH_VAPID_PUBLIC_KEY' | 'PUSH_VAPID_PRIVATE_KEY' | 'PUSH_VAPID_SUBJECT'>,
  opts: { nowSeconds?: number; ttlSeconds?: number } = {},
): Promise<PushResult> {
  try {
    const keys = vapidFromEnv(env);
    if (!keys) return { ok: false, status: 0 };

    const body = await encryptPayload(
      encoder.encode(typeof payload === 'string' ? payload : JSON.stringify(payload)),
      subscription.p256dh,
      subscription.auth,
    );
    const jwt = await vapidJwt(subscription.endpoint, keys, opts.nowSeconds);

    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        // How long the push service may hold it if the phone is offline. A meal
        // reminder is stale after a while.
        ttl: String(opts.ttlSeconds ?? 3600),
        urgency: 'normal',
      },
      body,
    });
    // Drain so the connection is released; the body is not needed.
    await res.arrayBuffer().catch(() => undefined);
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
