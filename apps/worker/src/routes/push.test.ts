import { env } from 'cloudflare:test';
import { signInitData } from '@snapbite/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { createPushDb } from '../db/push.js';
import { pushSubscriptions } from '../db/schema.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';
import { browserSubscription, vapidEnv } from '../test/pushFixtures.js';

const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';

async function as(tgId: number): Promise<Record<string, string>> {
  const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  return {
    [INIT_DATA_HEADER]: await signInitData({ user, auth_date: authDate }, BOT_TOKEN),
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Safari',
  };
}

const post = async (path: string, tgId: number, body: unknown, e: object = env) =>
  createApp().request(
    path,
    { method: 'POST', headers: await as(tgId), body: JSON.stringify(body) },
    e as typeof env,
  );

const rows = (endpoint: string) =>
  createPushDb(env.DB)
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint));

afterEach(() => vi.restoreAllMocks());

describe('GET /api/push/key', () => {
  it('returns the public VAPID key the browser subscribes with', async () => {
    const withKeys = { ...env, ...(await vapidEnv()) };
    const res = await createApp().request('/api/push/key', { headers: await as(9101) }, withKeys);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: withKeys.PUSH_VAPID_PUBLIC_KEY });
  });

  it('says so when push is not configured', async () => {
    const res = await createApp().request(
      '/api/push/key',
      { headers: await as(9102) },
      { ...env, PUSH_VAPID_PUBLIC_KEY: undefined },
    );
    expect(res.status).toBe(503);
  });

  it('needs an account like every /api route does (an anonymous cookie is enough)', async () => {
    const res = await createApp().request('/api/push/key', {}, { ...env, ...(await vapidEnv()) });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/push/subscribe', () => {
  it('stores the subscription with the caller and their user agent', async () => {
    const sub = await browserSubscription();
    const res = await post('/api/push/subscribe', 9111, sub);
    expect(res.status).toBe(200);

    const stored = await rows(sub.endpoint);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      failCount: 0,
    });
    expect(stored[0]?.userAgent).toContain('iPhone');
    expect(stored[0]?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('upserts by endpoint: subscribing the same device again does not duplicate it', async () => {
    const sub = await browserSubscription();
    await post('/api/push/subscribe', 9112, sub);
    const fresh = await browserSubscription();
    const again = await post('/api/push/subscribe', 9112, {
      endpoint: sub.endpoint,
      keys: fresh.keys,
    });
    expect(again.status).toBe(200);

    const stored = await rows(sub.endpoint);
    expect(stored).toHaveLength(1);
    // The row now carries the new keys.
    expect(stored[0]?.p256dh).toBe(fresh.keys.p256dh);
  });

  it('refuses an endpoint that is not a push service (the Worker would POST to it)', async () => {
    for (const endpoint of [
      'https://evil.example.com/hook',
      'http://web.push.apple.com/x',
      'https://web.push.apple.com.evil.example/x',
      'https://169.254.169.254/latest',
      'not a url',
    ]) {
      const sub = await browserSubscription();
      const res = await post('/api/push/subscribe', 9113, { ...sub, endpoint });
      expect(res.status, endpoint).toBe(400);
    }
  });

  it('accepts the real services: Apple, Google, Mozilla, Windows', async () => {
    for (const host of [
      'web.push.apple.com',
      'fcm.googleapis.com',
      'updates.push.services.mozilla.com',
      'wns2-par02p.notify.windows.com',
    ]) {
      const res = await post('/api/push/subscribe', 9114, await browserSubscription(host));
      expect(res.status, host).toBe(200);
    }
  });

  it('refuses keys that could never be encrypted to', async () => {
    const sub = await browserSubscription();
    for (const keys of [
      { p256dh: 'AAAA', auth: sub.keys.auth },
      { p256dh: sub.keys.p256dh, auth: 'AAAA' },
      { p256dh: sub.keys.p256dh },
      undefined,
    ]) {
      const res = await post('/api/push/subscribe', 9115, { endpoint: sub.endpoint, keys });
      expect(res.status).toBe(400);
    }
  });
});

describe('POST /api/push/unsubscribe', () => {
  it('removes the caller’s own subscription', async () => {
    const sub = await browserSubscription();
    await post('/api/push/subscribe', 9121, sub);

    const res = await post('/api/push/unsubscribe', 9121, { endpoint: sub.endpoint });
    expect(await res.json()).toEqual({ ok: true, removed: true });
    expect(await rows(sub.endpoint)).toHaveLength(0);
  });

  it('is scoped to the caller: another user cannot delete it', async () => {
    const sub = await browserSubscription();
    await post('/api/push/subscribe', 9122, sub);

    const res = await post('/api/push/unsubscribe', 9123, { endpoint: sub.endpoint });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: false });
    expect(await rows(sub.endpoint)).toHaveLength(1);
  });

  it('answers the same for an endpoint nobody has', async () => {
    const res = await post('/api/push/unsubscribe', 9124, {
      endpoint: 'https://web.push.apple.com/none',
    });
    expect(await res.json()).toEqual({ ok: true, removed: false });
  });
});

describe('POST /api/push/test', () => {
  it('sends one encrypted notification to the caller’s devices', async () => {
    const withKeys = { ...env, ...(await vapidEnv()) };
    const sub = await browserSubscription();
    await post('/api/push/subscribe', 9131, sub, withKeys);

    const seen: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      seen.push(String(input));
      return new Response(null, { status: 201 });
    });
    const res = await post('/api/push/test', 9131, {}, withKeys);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, delivered: 1, removed: 0 });
    expect(seen).toEqual([sub.endpoint]);
  });

  it('says so when there is nothing to send to', async () => {
    const res = await post('/api/push/test', 9132, {}, { ...env, ...(await vapidEnv()) });
    expect(res.status).toBe(409);
  });

  it('forgets a subscription the push service says is gone', async () => {
    const withKeys = { ...env, ...(await vapidEnv()) };
    const sub = await browserSubscription();
    await post('/api/push/subscribe', 9133, sub, withKeys);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 410 }));

    const res = await post('/api/push/test', 9133, {}, withKeys);
    expect(await res.json()).toMatchObject({ ok: false, delivered: 0, removed: 1, live: 0 });
    expect(await rows(sub.endpoint)).toHaveLength(0);
  });

  it('never touches another user’s subscriptions', async () => {
    const withKeys = { ...env, ...(await vapidEnv()) };
    const theirs = await browserSubscription();
    await post('/api/push/subscribe', 9134, theirs, withKeys);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }));

    const res = await post('/api/push/test', 9135, {}, withKeys);
    expect(res.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('account deletion', () => {
  it('takes the account’s push subscriptions with it', async () => {
    const sub = await browserSubscription();
    await post('/api/push/subscribe', 9141, sub);
    expect(await rows(sub.endpoint)).toHaveLength(1);

    const res = await createApp().request(
      '/api/account',
      { method: 'DELETE', headers: await as(9141) },
      env,
    );
    expect(res.status).toBe(200);
    expect(await rows(sub.endpoint)).toHaveLength(0);
  });
});
