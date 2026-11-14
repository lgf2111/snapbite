import { env } from 'cloudflare:test';
import { PhotonImage } from '@cf-wasm/photon';
import { AIProviderError, type MealImage, MockAIProvider, signInitData } from '@snapbite/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import {
  createDeviceToken,
  createDeviceTokensDb,
  hashDeviceToken,
  mintDeviceToken,
  revokeAllDeviceTokens,
} from '../db/deviceTokens.js';
import { recentErrors } from '../db/errors.js';
import { MAX_PHOTO_BYTES_PER_USER } from '../db/meals.js';
import type { ErrorLogRow } from '../db/schema.js';
import { createDb, upsertUser } from '../db/users.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';
import { base64FromBytes } from '../storage/images.js';
import { photoKey } from '../storage/photos.js';
import { oneLine } from './shortcut.js';

/**
 * The route must never hand a photo to Photon: that decode + re-encode was the
 * 1102. Mocking the WASM module makes any accidental call visible as a spy.
 */
vi.mock('@cf-wasm/photon', () => ({
  PhotonImage: { new_from_byteslice: vi.fn() },
  SamplingFilter: { Lanczos3: 0 },
  resize: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

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

/** A multipart request shaped like the Shortcut's `Request Body: Form`. */
function photoForm(bytes: Uint8Array): FormData {
  const form = new FormData();
  form.append('photo', new File([bytes], 'photo.jpg', { type: 'image/jpeg' }));
  return form;
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
    expect(text).toMatch(/^\d+ kcal — /);

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
    expect(await res.text()).toMatch(/^\d+ kcal — /);
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

  describe('upload size guard and stage logging', () => {
    it('rejects a 2.5 MB photo with 413 before touching Photon', async () => {
      const app = createApp({ providerFactory: () => new MockAIProvider() });
      const token = await tokenFor(app, 9610);
      const bytes = new Uint8Array(2.5 * 1024 * 1024);
      bytes.set([0xff, 0xd8, 0xff]);

      const res = await app.request(
        '/api/shortcut/log',
        { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: photoForm(bytes) },
        env,
      );

      expect(res.status).toBe(413);
      expect(await res.text()).toBe(
        'SnapBite: that photo is too big — set Resize Image to 1024 in the shortcut',
      );
      expect(PhotonImage.new_from_byteslice).not.toHaveBeenCalled();
    });

    it('passes a 300 KB photo to the provider byte-for-byte (no second encode)', async () => {
      const provider = new MockAIProvider();
      const app = createApp({ providerFactory: () => provider });
      const token = await tokenFor(app, 9611);
      const bytes = new Uint8Array(300 * 1024);
      bytes.set([0xff, 0xd8, 0xff, 0xe0]);
      for (let i = 4; i < bytes.length; i++) bytes[i] = i & 0xff;

      const res = await app.request(
        '/api/shortcut/log',
        { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: photoForm(bytes) },
        env,
      );

      expect(res.status).toBe(200);
      expect(provider.lastImage?.base64).toBe(base64FromBytes(bytes));
      expect(provider.lastImage?.mimeType).toBe('image/jpeg');
      expect(PhotonImage.new_from_byteslice).not.toHaveBeenCalled();
    });

    it('writes an ai_started row before the provider call and completes it after', async () => {
      let seen: ErrorLogRow[] = [];
      const base = new MockAIProvider();
      const provider = {
        id: 'mock',
        analyzeMeal: async (image: MealImage) => {
          seen = await recentErrors(env.DB, 200);
          return base.analyzeMeal(image);
        },
      };
      const app = createApp({ providerFactory: () => provider as never });
      const token = await tokenFor(app, 9612);

      const res = await app.request('/api/shortcut/log', post(token), env);
      expect(res.status).toBe(200);

      // The row exists while the AI call is still running.
      const started = seen.find((r) => r.telegramUserId === 9612 && r.kind === 'ai_started');
      expect(started).toBeTruthy();
      expect(JSON.parse(started?.detail ?? '{}')).toMatchObject({ bytes_in: 5 });

      // The same row (not a second one) is rewritten with the measured stages.
      const rows = (await recentErrors(env.DB, 200)).filter((r) => r.id === started?.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('completed');
      expect(rows[0]?.status).toBe(200);
      const detail = JSON.parse(rows[0]?.detail ?? '{}') as Record<string, number>;
      expect(detail.bytes_in).toBe(5);
      expect(detail.ms_shrink).toBe(0);
      expect(typeof detail.ms_ai).toBe('number');
      expect(typeof detail.ms_total).toBe('number');
      expect(typeof detail.ms_base64).toBe('number');
    });
  });

  describe('abuse limits', () => {
    it('aborts a chunked 5 MB body at 2 MB with 413 and never reads it all', async () => {
      const app = createApp({ providerFactory: () => new MockAIProvider() });
      const token = await tokenFor(app, 9620);
      const chunkSize = 64 * 1024;
      const totalChunks = Math.ceil((5 * 1024 * 1024) / chunkSize);
      let pulled = 0;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled >= totalChunks) {
            controller.close();
            return;
          }
          const chunk = new Uint8Array(chunkSize);
          chunk.set([0xff, 0xd8, 0xff]);
          pulled++;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      });

      // No Content-Length: the hard reader is the only thing bounding this.
      const req = new Request('http://localhost/api/shortcut/log', {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg', authorization: `Bearer ${token}` },
        body,
      });
      const res = await app.fetch(req, env);

      expect(res.status).toBe(413);
      expect(await res.text()).toBe(
        'SnapBite: that photo is too big — set Resize Image to 1024 in the shortcut',
      );
      // 33 chunks (2.06 MB) is enough to cross the 2 MB cap; the other 47 never leave.
      expect(pulled).toBeLessThan(totalChunks);
      expect(pulled * chunkSize).toBeGreaterThan(2 * 1024 * 1024);
      expect(pulled * chunkSize).toBeLessThanOrEqual(2 * 1024 * 1024 + chunkSize);
      expect(cancelled).toBe(true);
    });

    it('allows 30 requests in an hour and rejects the 31st with a readable 429', async () => {
      const app = createApp({ providerFactory: () => new MockAIProvider() });
      const token = await tokenFor(app, 9621);

      for (let i = 0; i < 29; i++) {
        const res = await app.request('/api/shortcut/log', post(token), env);
        expect(res.status).toBe(200);
      }
      // The 30th request still succeeds...
      expect((await app.request('/api/shortcut/log', post(token), env)).status).toBe(200);
      // ...the 31st is refused, in the same plain-text style.
      const res = await app.request('/api/shortcut/log', post(token), env);
      expect(res.status).toBe(429);
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(await res.text()).toBe('SnapBite: too many requests, try again later');
    });

    it('does not share a window between two tokens', async () => {
      const app = createApp({ providerFactory: () => new MockAIProvider() });
      const first = await tokenFor(app, 9622);
      const second = await tokenFor(app, 9623);

      for (let i = 0; i < 30; i++) {
        expect((await app.request('/api/shortcut/log', post(first), env)).status).toBe(200);
      }
      expect((await app.request('/api/shortcut/log', post(first), env)).status).toBe(429);
      // The second token has its own counter and is unaffected.
      expect((await app.request('/api/shortcut/log', post(second), env)).status).toBe(200);
    });

    it('still logs the meal but writes no R2 object past the photo quota', async () => {
      const app = createApp({ providerFactory: () => new MockAIProvider() });
      const token = await tokenFor(app, 9624);
      const user = await upsertUser(createDb(env.DB), { id: 9624 });
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO meals (id, user_id, photo_key, photo_mime, photo_bytes, created_at, logged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          user.id,
          'photos/already-at-quota',
          'image/jpeg',
          MAX_PHOTO_BYTES_PER_USER,
          now,
          now,
        )
        .run();

      const res = await app.request('/api/shortcut/log', post(token), env);
      expect(res.status).toBe(200);
      expect(await res.text()).toMatch(/^\d+ kcal — /);

      const row = await env.DB.prepare(
        `SELECT id, photo_key AS photoKey FROM meals
          WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
        .bind(user.id)
        .first<{ id: string; photoKey: string | null }>();
      expect(row).toBeTruthy();
      // The meal is saved, but the quota check stopped the R2 write.
      expect(row?.photoKey).toBeNull();
      expect(await env.PHOTOS.get(photoKey(row?.id as string))).toBeNull();
    });

    it('answers a no-credits account with a sentence, not a 500', async () => {
      const app = createApp({ providerFactory: () => new MockAIProvider() });
      const user = await upsertUser(createDb(env.DB), { id: 9625 });
      await env.DB.prepare('UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?')
        .bind('shortcut-no-credits@example.com', Date.now(), user.id)
        .run();
      const raw = mintDeviceToken();
      await createDeviceToken(createDeviceTokensDb(env.DB), {
        userId: user.id,
        tokenHash: await hashDeviceToken(raw),
      });

      // A hosted key exists, so this is the "signed in, no credits" path.
      const res = await app.request('/api/shortcut/log', post(raw), {
        ...env,
        GEMINI_API_KEY: 'hosted-gemini-key',
      });
      expect(res.status).toBe(402);
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(await res.text()).toBe(
        "SnapBite: Your AI key hit its limit and you're out of credits. Add credits in Settings, or use a working key.",
      );
    });
  });

  describe('reply contract', () => {
    const failing = (err: unknown) => ({
      analyzeMeal: async () => {
        throw err;
      },
    });

    it('answers text/plain with exactly two lines shaped like the confirm card, never JSON', async () => {
      const app = createApp({ providerFactory: () => new MockAIProvider() });
      const token = await tokenFor(app, 9501);
      const res = await app.request('/api/shortcut/log', post(token), env);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      const text = await res.text();
      expect(text).toMatch(/^\d+ kcal — .+\nP \d+ g · C \d+ g · F \d+ g$/);
      expect(text).not.toContain('{');
      expect(text.length).toBeLessThan(120);
      expect(text.split('\n')).toHaveLength(2);
      expect((text.split('\n')[0] as string).length).toBeLessThan(60);
      // No emoji.
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
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
      expect(text).toMatch(/^\d+ kcal — Grilled salmon, rice\nP \d+ g · C \d+ g · F \d+ g$/);
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
      const [line1, line2] = text.split('\n') as [string, string];
      expect(line1.length).toBeLessThan(60);
      // The kcal is never what gets cut, and the macros line is untouched.
      expect(line1).toMatch(/^\d+ kcal — x+…$/);
      expect(line2).toMatch(/^P \d+ g · C \d+ g · F \d+ g$/);
    });

    it('rounds macros to whole grams and puts kcal first', () => {
      expect(
        oneLine({
          kcal: 16.6,
          label: 'Want Want milk candy',
          macros: { proteinG: 0.4, carbsG: 2.6, fatG: 0.04 },
        }),
      ).toBe('17 kcal — Want Want milk candy\nP 0 g · C 3 g · F 0 g');
    });

    it('never cuts the kcal, whatever the title, and stays under 120 characters', () => {
      for (const kcal of [7, 1234, 99999]) {
        const out = oneLine({
          kcal,
          label: 'y'.repeat(300),
          macros: { proteinG: 99999, carbsG: 99999, fatG: 99999 },
        });
        expect(out.startsWith(`${kcal} kcal — `)).toBe(true);
        expect((out.split('\n')[0] as string).length).toBeLessThan(60);
        expect(out.length).toBeLessThan(120);
        expect(out.split('\n')).toHaveLength(2);
      }
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
      expect(body.message).toMatch(/^\d+ kcal — .+\nP \d+ g · C \d+ g · F \d+ g$/);
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

    it('every failure is one readable line, with no second line', async () => {
      const app = createApp({ providerFactory: () => new MockAIProvider() });
      const token = await tokenFor(app, 9511);
      const cases = [
        await app.request('/api/shortcut/log', post(null), env),
        await app.request(
          '/api/shortcut/log',
          post(token, { base64: '', mimeType: 'image/jpeg' }),
          env,
        ),
        await app.request(
          '/api/shortcut/log',
          post(token, { base64: 'aGVsbG8=', mimeType: 'image/heic' }),
          env,
        ),
      ];
      for (const res of cases) {
        expect(res.status).toBeGreaterThanOrEqual(400);
        const text = await res.text();
        expect(text).toMatch(/^SnapBite: /);
        expect(text).not.toContain('\n');
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
