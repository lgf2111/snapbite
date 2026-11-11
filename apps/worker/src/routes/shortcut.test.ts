import { env } from 'cloudflare:test';
import { AIProviderError, MockAIProvider, signInitData } from '@snapbite/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import {
  createDeviceToken,
  createDeviceTokensDb,
  hashDeviceToken,
  mintDeviceToken,
  revokeAllDeviceTokens,
} from '../db/deviceTokens.js';
import { createDb, upsertUser } from '../db/users.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';

const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';
const IMAGE_BODY = { base64: 'aGVsbG8=', mimeType: 'image/jpeg' };

async function authHeaders(tgId: number): Promise<Record<string, string>> {
  const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  return {
    [INIT_DATA_HEADER]: await signInitData({ user, auth_date: authDate }, BOT_TOKEN),
    'content-type': 'application/json',
  };
}

/** Creates the user, saves a BYOK key through the public API, mints a token. */
async function tokenFor(app: ReturnType<typeof createApp>, tgId: number): Promise<string> {
  const headers = await authHeaders(tgId);
  await app.request(
    '/api/settings',
    { method: 'PUT', headers, body: JSON.stringify({ apiKey: 'sk-test-key' }) },
    env,
  );
  const user = await upsertUser(createDb(env.DB), { id: tgId });
  const raw = mintDeviceToken();
  await createDeviceToken(createDeviceTokensDb(env.DB), {
    userId: user.id,
    tokenHash: await hashDeviceToken(raw),
  });
  return raw;
}

function post(token: string | null, body: unknown = IMAGE_BODY) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { method: 'POST', headers, body: JSON.stringify(body) } as const;
}

describe('POST /api/shortcut/log', () => {
  it('rejects a request with no token', async () => {
    const app = createApp({ providerFactory: () => new MockAIProvider() });
    const res = await app.request('/api/shortcut/log', post(null), env);
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/^SnapBite: .*device token/);
  });

  it('rejects an unknown token', async () => {
    const app = createApp({ providerFactory: () => new MockAIProvider() });
    const res = await app.request('/api/shortcut/log', post('sb_not-a-real-token'), env);
    expect(res.status).toBe(401);
  });

  it('analyses, saves the meal and answers in one line', async () => {
    const app = createApp({ providerFactory: () => new MockAIProvider() });
    const token = await tokenFor(app, 8201);

    const res = await app.request('/api/shortcut/log', post(token), env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/^Logged \d+ kcal — /);

    // The meal is really persisted and visible to the normal API.
    const list = await app.request('/api/meals', { headers: await authHeaders(8201) }, env);
    const body = (await list.json()) as unknown;
    const arr = Array.isArray(body) ? body : ((body as { meals?: unknown[] }).meals ?? []);
    expect(arr.length).toBe(1);
  });

  it('refuses an account with no AI key', async () => {
    const app = createApp({ providerFactory: () => new MockAIProvider() });
    const user = await upsertUser(createDb(env.DB), { id: 8202 });
    const raw = mintDeviceToken();
    await createDeviceToken(createDeviceTokensDb(env.DB), {
      userId: user.id,
      tokenHash: await hashDeviceToken(raw),
    });

    const res = await app.request('/api/shortcut/log', post(raw), env);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('SnapBite: add your AI key in Settings first');
  });

  it('rejects a HEIC upload with a usable message', async () => {
    const app = createApp({ providerFactory: () => new MockAIProvider() });
    const token = await tokenFor(app, 8203);
    const res = await app.request(
      '/api/shortcut/log',
      post(token, { base64: 'aGVsbG8=', mimeType: 'image/heic' }),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Convert Image');
  });

  it('stops working once the token is revoked', async () => {
    const app = createApp({ providerFactory: () => new MockAIProvider() });
    const token = await tokenFor(app, 8204);
    const user = await upsertUser(createDb(env.DB), { id: 8204 });
    expect(await revokeAllDeviceTokens(createDeviceTokensDb(env.DB), user.id)).toBe(1);

    const res = await app.request('/api/shortcut/log', post(token), env);
    expect(res.status).toBe(401);
  });

  it('accepts a raw image body (Request Body: File in Shortcuts)', async () => {
    const app = createApp({ providerFactory: () => new MockAIProvider() });
    const token = await tokenFor(app, 8205);
    // Minimal JPEG header bytes — enough for the mime sniffer.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const res = await app.request(
      '/api/shortcut/log',
      {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg', authorization: `Bearer ${token}` },
        body: jpeg,
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^Logged \d+ kcal — /);
  });

  it('answers a connectivity ping', async () => {
    const app = createApp({ providerFactory: () => new MockAIProvider() });
    const token = await tokenFor(app, 8206);
    const res = await app.request(
      '/api/shortcut/ping',
      { headers: { authorization: `Bearer ${token}` } },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('pong');
  });

  it('stores the photo bytes so the meal detail can render them', async () => {
    const app = createApp({ providerFactory: () => new MockAIProvider() });
    const token = await tokenFor(app, 8207);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

    const res = await app.request(
      '/api/shortcut/log',
      {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg', authorization: `Bearer ${token}` },
        body: jpeg,
      },
      env,
    );
    expect(res.status).toBe(200);

    // The detail endpoint must report a renderable photo, and the object must
    // actually exist in the bucket.
    const listRes = await app.request('/api/meals', { headers: await authHeaders(8207) }, env);
    const body = (await listRes.json()) as unknown;
    const arr = Array.isArray(body) ? body : ((body as { meals?: unknown[] }).meals ?? []);
    const mealId = (arr[0] as { id: string }).id;

    const single = await app.request(
      `/api/meals/${mealId}`,
      { headers: await authHeaders(8207) },
      env,
    );
    const full = (await single.json()) as { hasPhoto: boolean };
    expect(full.hasPhoto).toBe(true);

    const obj = await env.PHOTOS.get(`photos/${mealId}`);
    expect(obj).not.toBeNull();
  });

  describe('reply contract', () => {
    const failing = (err: unknown) => ({
      analyzeMeal: async () => {
        throw err;
      },
    });

    it('answers text/plain with one short readable line, never JSON', async () => {
      const app = createApp({ providerFactory: () => new MockAIProvider() });
      const token = await tokenFor(app, 9501);
      const res = await app.request('/api/shortcut/log', post(token), env);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      const text = await res.text();
      expect(text).toMatch(/^Logged \d+ kcal — .+/);
      expect(text).not.toContain('{');
      expect(text.length).toBeLessThan(120);
    });

    it('uses the analyser label, not the whole ingredient list', async () => {
      const base = await new MockAIProvider().analyzeMeal(
        { base64: 'aGVsbG8=', mimeType: 'image/jpeg' },
        {},
      );
      const provider = {
        analyzeMeal: async () => ({ ...base, title: '  Grilled salmon, rice  ' }),
      };
      const app = createApp({ providerFactory: () => provider as never });
      const token = await tokenFor(app, 9502);
      const text = await (await app.request('/api/shortcut/log', post(token), env)).text();
      expect(text).toMatch(/^Logged \d+ kcal — Grilled salmon, rice( \(P \d+ · C \d+ · F \d+\))?$/);
    });

    it('trims a very long label so the line stays under the length budget', async () => {
      const base = await new MockAIProvider().analyzeMeal(
        { base64: 'aGVsbG8=', mimeType: 'image/jpeg' },
        {},
      );
      const provider = { analyzeMeal: async () => ({ ...base, title: 'x'.repeat(200) }) };
      const app = createApp({ providerFactory: () => provider as never });
      const token = await tokenFor(app, 9503);
      const text = await (await app.request('/api/shortcut/log', post(token), env)).text();
      expect(text.length).toBeLessThan(120);
      expect(text).toContain('…');
    });

    it('?format=json answers a structured body with the same message and status', async () => {
      const app = createApp({ providerFactory: () => new MockAIProvider() });
      const token = await tokenFor(app, 9504);
      const res = await app.request('/api/shortcut/log?format=json', post(token), env);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = (await res.json()) as {
        ok: boolean;
        message: string;
        mealId: string;
        label: string;
        kcal: number;
        macros: { proteinG: number; carbsG: number; fatG: number };
      };
      expect(body.ok).toBe(true);
      expect(body.message).toMatch(/^Logged \d+ kcal — /);
      expect(typeof body.mealId).toBe('string');
      expect(typeof body.label).toBe('string');
      expect(typeof body.kcal).toBe('number');
      expect(Object.keys(body.macros).sort()).toEqual(['carbsG', 'fatG', 'proteinG']);
    });

    it('?format=json keeps failures structured and on the same status', async () => {
      const app = createApp({ providerFactory: () => new MockAIProvider() });
      const user = await upsertUser(createDb(env.DB), { id: 9505 });
      const raw = mintDeviceToken();
      await createDeviceToken(createDeviceTokensDb(env.DB), {
        userId: user.id,
        tokenHash: await hashDeviceToken(raw),
      });
      const res = await app.request('/api/shortcut/log?format=json', post(raw), env);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        ok: false,
        message: 'SnapBite: add your AI key in Settings first',
      });
    });

    it('a missing or bad token is a readable 401, no-store', async () => {
      const app = createApp({ providerFactory: () => new MockAIProvider() });
      for (const token of [null, 'sb_not-a-real-token']) {
        const res = await app.request('/api/shortcut/log', post(token), env);
        expect(res.status).toBe(401);
        expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
        expect(res.headers.get('cache-control')).toBe('no-store');
        const text = await res.text();
        expect(text).toMatch(/^SnapBite: /);
        expect(text).not.toContain('{');
      }
    });

    it('an unreadable upload says so, with 400', async () => {
      const app = createApp({ providerFactory: () => new MockAIProvider() });
      const token = await tokenFor(app, 9506);
      const res = await app.request(
        '/api/shortcut/log',
        post(token, { base64: '', mimeType: 'image/jpeg' }),
        env,
      );
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('SnapBite: the photo was not readable, try again');
    });

    it('an unparseable analysis says the photo was not readable, with 502', async () => {
      const app = createApp({
        providerFactory: () =>
          failing(new AIProviderError('parse', 'bad json from model')) as never,
      });
      const token = await tokenFor(app, 9507);
      const res = await app.request('/api/shortcut/log', post(token), env);
      expect(res.status).toBe(502);
      expect(await res.text()).toBe('SnapBite: the photo was not readable, try again');
    });

    it('an analysis with no food says no meal was detected, with 502', async () => {
      const app = createApp({
        providerFactory: () => failing(new AIProviderError('empty', 'no foods')) as never,
      });
      const token = await tokenFor(app, 9508);
      const res = await app.request('/api/shortcut/log', post(token), env);
      expect(res.status).toBe(502);
      expect(await res.text()).toBe('SnapBite: no meal detected in that photo');
    });

    it('a provider outage never leaks its raw message into the notification', async () => {
      const app = createApp({
        providerFactory: () =>
          failing(new AIProviderError('http', '{"error":"quota"}', { status: 429 })) as never,
      });
      const token = await tokenFor(app, 9509);
      const res = await app.request('/api/shortcut/log', post(token), env);
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(text).toMatch(/^SnapBite: /);
      expect(text).not.toContain('{');
    });
  });
});
