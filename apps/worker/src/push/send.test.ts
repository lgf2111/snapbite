import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type VapidKeys,
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  isGone,
  sendPush,
  vapidJwt,
} from './send.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A browser's subscription: an ECDH keypair plus a 16-byte auth secret. */
async function browserSubscription() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const p256dh = new Uint8Array(
    (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer,
  );
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    pair,
    p256dh: b64urlEncode(p256dh),
    auth: b64urlEncode(auth),
    authBytes: auth,
    p256dhBytes: p256dh,
  };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, base, bytes * 8),
  );
}

/**
 * The receiving side, written separately from the sender from RFC 8291 §3.4: what
 * the browser's push service client does to read a message. If this reads what
 * `encryptPayload` wrote, the two agree on the format.
 */
async function decrypt(
  body: Uint8Array,
  browser: Awaited<ReturnType<typeof browserSubscription>>,
): Promise<{ plaintext: string; recordSize: number; keyIdLength: number }> {
  const salt = body.slice(0, 16);
  const recordSize = new DataView(body.buffer, body.byteOffset).getUint32(16, false);
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
      browser.pair.privateKey,
      256,
    ),
  );
  const keyInfo = new Uint8Array([
    ...enc.encode('WebPush: info\0'),
    ...browser.p256dhBytes,
    ...asPublic,
  ]);
  const ikm = await hkdf(browser.authBytes, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const record = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext),
  );

  // Strip padding: the last record ends with 0x02 (then optional zeros before it? no: zeros follow 0x02).
  let end = record.length;
  while (end > 0 && record[end - 1] === 0) end--;
  expect(record[end - 1]).toBe(0x02);
  return { plaintext: dec.decode(record.slice(0, end - 1)), recordSize, keyIdLength: idLen };
}

async function vapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return {
    publicKey: b64urlEncode(pub),
    privateKey: jwk.d as string,
    subject: 'mailto:lgf2111@gmail.com',
  };
}

afterEach(() => vi.restoreAllMocks());

describe('payload encryption (RFC 8291 aes128gcm)', () => {
  it('round-trips: what we encrypt, the browser decrypts', async () => {
    const browser = await browserSubscription();
    const message = JSON.stringify({
      title: 'Lunch',
      body: 'Log your meal while it is fresh.',
      url: '/',
    });

    const body = await encryptPayload(enc.encode(message), browser.p256dh, browser.auth);
    const out = await decrypt(body, browser);

    expect(out.plaintext).toBe(message);
  });

  it('writes the header the spec asks for: salt(16) | rs(4)=4096 | idlen(1)=65 | keyid(65)', async () => {
    const browser = await browserSubscription();
    const body = await encryptPayload(enc.encode('hi'), browser.p256dh, browser.auth);

    expect(new DataView(body.buffer, body.byteOffset).getUint32(16, false)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(body[21]).toBe(0x04); // an uncompressed P-256 point
    // header (86) + payload + delimiter (1) + GCM tag (16)
    expect(body.length).toBe(16 + 4 + 1 + 65 + 2 + 1 + 16);
  });

  it('is not plaintext, and is different every time (fresh salt and key)', async () => {
    const browser = await browserSubscription();
    const a = await encryptPayload(enc.encode('secret reminder'), browser.p256dh, browser.auth);
    const b = await encryptPayload(enc.encode('secret reminder'), browser.p256dh, browser.auth);
    expect(dec.decode(a)).not.toContain('secret reminder');
    expect(b64urlEncode(a)).not.toBe(b64urlEncode(b));
  });

  it('cannot be read with the wrong auth secret or by another browser', async () => {
    const browser = await browserSubscription();
    const stranger = await browserSubscription();
    const body = await encryptPayload(enc.encode('x'), browser.p256dh, browser.auth);
    await expect(
      decrypt(body, { ...browser, authBytes: crypto.getRandomValues(new Uint8Array(16)) }),
    ).rejects.toThrow();
    await expect(decrypt(body, stranger)).rejects.toThrow();
  });

  it('rejects malformed subscription keys', async () => {
    const browser = await browserSubscription();
    await expect(encryptPayload(enc.encode('x'), 'AAAA', browser.auth)).rejects.toThrow(/p256dh/);
    await expect(encryptPayload(enc.encode('x'), browser.p256dh, 'AAAA')).rejects.toThrow(/auth/);
  });

  it('handles a non-ASCII payload', async () => {
    const browser = await browserSubscription();
    const message = '🍳 早餐时间 — log it';
    const body = await encryptPayload(enc.encode(message), browser.p256dh, browser.auth);
    expect((await decrypt(body, browser)).plaintext).toBe(message);
  });
});

describe('VAPID JWT (RFC 8292)', () => {
  const ENDPOINT = 'https://web.push.apple.com/QGxx/abc?x=1';

  it('is a verifiable ES256 token with the right aud, exp and sub', async () => {
    const keys = await vapidKeys();
    const now = 1_790_000_000;
    const jwt = await vapidJwt(ENDPOINT, keys, now);
    const [h, p, s] = jwt.split('.') as [string, string, string];

    expect(JSON.parse(dec.decode(b64urlDecode(h)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(dec.decode(b64urlDecode(p)))).toEqual({
      aud: 'https://web.push.apple.com',
      exp: now + 12 * 3600,
      sub: 'mailto:lgf2111@gmail.com',
    });

    // 64-byte r||s, which verifies against the public key.
    const signature = b64urlDecode(s);
    expect(signature.length).toBe(64);
    const pub = await crypto.subtle.importKey(
      'raw',
      b64urlDecode(keys.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pub,
      signature,
      enc.encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it('does not verify against a different key', async () => {
    const keys = await vapidKeys();
    const other = await vapidKeys();
    const [h, p, s] = (await vapidJwt(ENDPOINT, keys)).split('.') as [string, string, string];
    const pub = await crypto.subtle.importKey(
      'raw',
      b64urlDecode(other.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    expect(
      await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        pub,
        b64urlDecode(s),
        enc.encode(`${h}.${p}`),
      ),
    ).toBe(false);
  });

  it('uses the origin of whichever push service owns the endpoint', async () => {
    const keys = await vapidKeys();
    const aud = async (url: string) => {
      const p = (await vapidJwt(url, keys)).split('.')[1] as string;
      return JSON.parse(dec.decode(b64urlDecode(p))).aud;
    };
    expect(await aud('https://fcm.googleapis.com/fcm/send/xyz')).toBe('https://fcm.googleapis.com');
    expect(await aud('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(
      'https://updates.push.services.mozilla.com',
    );
  });
});

describe('sendPush', () => {
  async function setup() {
    const keys = await vapidKeys();
    const browser = await browserSubscription();
    const env = {
      PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
      PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
      PUSH_VAPID_SUBJECT: keys.subject,
    };
    const sub = {
      endpoint: 'https://web.push.apple.com/abc',
      p256dh: browser.p256dh,
      auth: browser.auth,
    };
    return { keys, browser, env, sub };
  }

  it('posts an encrypted body with the VAPID and encoding headers', async () => {
    const { keys, browser, env, sub } = await setup();
    const seen: Array<{ url: string; init: RequestInit }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      seen.push({ url: String(input), init: init as RequestInit });
      return new Response(null, { status: 201 });
    });

    const res = await sendPush(
      sub,
      { title: 'Lunch', body: 'Log your meal while it is fresh.', url: '/' },
      env,
    );

    expect(res).toEqual({ ok: true, status: 201 });
    const { url, init } = seen[0] as { url: string; init: RequestInit };
    const headers = init.headers as Record<string, string>;
    expect(url).toBe(sub.endpoint);
    expect(headers['content-encoding']).toBe('aes128gcm');
    expect(headers.ttl).toBeDefined();
    expect(headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    expect(headers.authorization).toContain(`k=${keys.publicKey}`);
    // The body the browser would receive decrypts to our payload.
    const out = await decrypt(init.body as Uint8Array, browser);
    expect(JSON.parse(out.plaintext)).toEqual({
      title: 'Lunch',
      body: 'Log your meal while it is fresh.',
      url: '/',
    });
  });

  it('reports a dead subscription (404 / 410)', async () => {
    const { env, sub } = await setup();
    for (const status of [404, 410]) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status }));
      const res = await sendPush(sub, 'x', env);
      expect(res).toEqual({ ok: false, status });
      expect(isGone(res)).toBe(true);
    }
  });

  it('reports other refusals without calling them dead', async () => {
    const { env, sub } = await setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 429 }));
    const res = await sendPush(sub, 'x', env);
    expect(res).toEqual({ ok: false, status: 429 });
    expect(isGone(res)).toBe(false);
  });

  it('never throws: network error, bad keys, missing VAPID keys', async () => {
    const { env, sub } = await setup();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    expect(await sendPush(sub, 'x', env)).toEqual({ ok: false, status: 0 });

    expect(await sendPush({ ...sub, p256dh: 'not-a-key' }, 'x', env)).toEqual({
      ok: false,
      status: 0,
    });
    expect(await sendPush(sub, 'x', { ...env, PUSH_VAPID_PRIVATE_KEY: undefined })).toEqual({
      ok: false,
      status: 0,
    });
    expect(await sendPush({ ...sub, endpoint: 'not a url' }, 'x', env)).toEqual({
      ok: false,
      status: 0,
    });
  });
});
