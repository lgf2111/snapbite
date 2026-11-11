import { b64urlEncode } from '../push/send.js';

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
  };
}
