import { b64urlDecode, b64urlEncode } from '../push/send.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A fresh VAPID keypair in the shape the Worker's secrets have. */
export async function vapidEnv() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return {
    PUSH_VAPID_PUBLIC_KEY: b64urlEncode(pub),
    PUSH_VAPID_PRIVATE_KEY: jwk.d as string,
    PUSH_VAPID_SUBJECT: 'mailto:lgf2111@gmail.com',
  };
}

/** What a browser sends to /api/push/subscribe (PushSubscription.toJSON()). */
export async function browserSubscription(host = 'web.push.apple.com') {
  const { endpoint, keys } = await browserSubscriptionWithKeys(host);
  return { endpoint, keys };
}

/**
 * The same subscription plus its private half, for tests that decrypt what the
 * Worker sent. Kept separate so the JSON shape above stays browser-identical.
 */
export async function browserSubscriptionWithKeys(host = 'web.push.apple.com') {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const p256dh = new Uint8Array(
    (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer,
  );
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint: `https://${host}/${crypto.randomUUID()}`,
    keys: { p256dh: b64urlEncode(p256dh), auth: b64urlEncode(auth) },
    pair,
  };
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  bytes: number,
): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, base, bytes * 8),
  );
}

/**
 * Decrypts one aes128gcm push body with the subscription's own key, mirroring
 * the receiving side. Used to assert what the reminder cron actually sent.
 */
export async function decryptPush(
  body: Uint8Array,
  subscription: Awaited<ReturnType<typeof browserSubscriptionWithKeys>>,
): Promise<string> {
  const salt = body.slice(0, 16);
  const idLen = body[20] as number;
  const asPublic = body.slice(21, 21 + idLen);
  const ciphertext = body.slice(21 + idLen);

  const asKey = await crypto.subtle.importKey(
    'raw',
    asPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      subscription.pair.privateKey,
      256,
    ),
  );
  const uaPublic = b64urlDecode(subscription.keys.p256dh);
  const authSecret = b64urlDecode(subscription.keys.auth);
  const ikm = await hkdf(
    authSecret,
    ecdh,
    concat(enc.encode('WebPush: info\0'), uaPublic, asPublic),
    32,
  );
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const record = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext),
  );

  let end = record.length;
  while (end > 0 && record[end - 1] === 0) end -= 1;
  return dec.decode(record.slice(0, end - 1));
}
