import { env } from 'cloudflare:test';
import { type BotReply, signInitData } from '@snapbite/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createMealsDb, setMealPhoto } from '../db/meals.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';
import { photoKey } from '../storage/photos.js';
import { jpegDimensions, photoJpeg, toBase64 } from '../test/photos.js';

const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';

function bot(sent: Array<{ chatId: number; reply: BotReply }>) {
  return {
    async sendMessage(chatId: number, reply: BotReply) {
      sent.push({ chatId, reply });
      return { messageId: 1 };
    },
    async getFilePath() {
      return 'photos/x.jpg';
    },
    async downloadFile() {
      // 1x1 pixel-ish bytes, base64.
      return { base64: 'QUJD', mimeType: 'image/jpeg' };
    },
  };
}

async function initFor(tgId: number): Promise<string> {
  const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  return signInitData({ user, auth_date: authDate }, BOT_TOKEN);
}

const MEAL = {
  foods: [
    {
      food: { name: 'rice', estimatedWeightG: 100, quantity: 1, confidence: 0.9 },
      nutrition: { energyKcal: 100, proteinG: 1, carbsG: 1, fatG: 1, source: 'table' },
    },
  ],
  total: { energyKcal: 100, proteinG: 1, carbsG: 1, fatG: 1, source: 'table' },
  confidence: 0.9,
  needsConfirmation: false,
};

async function saveTextMeal(tgId: number): Promise<string> {
  const app = createApp();
  const res = await app.request(
    '/api/meals',
    {
      method: 'POST',
      headers: { [INIT_DATA_HEADER]: await initFor(tgId), 'content-type': 'application/json' },
      body: JSON.stringify({ meal: MEAL }),
    },
    env,
  );
  return ((await res.json()) as { id: string }).id;
}

describe('GET /api/meal-photo/:id', () => {
  it('401s without initData', async () => {
    const app = createApp();
    const res = await app.request('/api/meal-photo/anything', {}, env);
    expect(res.status).toBe(401);
  });

  it('404s when the meal has no photo', async () => {
    const tgId = 9001;
    const id = await saveTextMeal(tgId);
    const app = createApp({ botClientFactory: () => bot([]) });
    const res = await app.request(
      `/api/meal-photo/${id}?initData=${encodeURIComponent(await initFor(tgId))}`,
      {},
      env,
    );
    expect(res.status).toBe(404);
  });

  it('serves the image for a photo-backed meal', async () => {
    // Log a photo via the webhook path so the meal gets a telegram_file_id.
    const tgId = 9002;
    // Save a key so the webhook can analyze.
    const keyApp = createApp();
    await keyApp.request(
      '/api/settings',
      {
        method: 'PUT',
        headers: { [INIT_DATA_HEADER]: await initFor(tgId), 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'sk-x' }),
      },
      env,
    );

    const { MockAIProvider } = await import('@snapbite/core');
    const app = createApp({
      botClientFactory: () => bot([]),
      providerFactory: () => new MockAIProvider(),
    });
    await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-webhook-secret',
        },
        body: JSON.stringify({
          message: { photo: [{ file_id: 'pf1' }], chat: { id: tgId }, from: { id: tgId } },
        }),
      },
      env,
    );

    const list = (await (
      await app.request('/api/meals', { headers: { [INIT_DATA_HEADER]: await initFor(tgId) } }, env)
    ).json()) as { meals: Array<{ id: string; hasPhoto: boolean }> };
    const photoMeal = list.meals.find((m) => m.hasPhoto);
    expect(photoMeal).toBeDefined();

    const res = await app.request(
      `/api/meal-photo/${photoMeal?.id}?initData=${encodeURIComponent(await initFor(tgId))}`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });
});

describe('GET /api/meal-photo/:id with only a cookie (the browser case)', () => {
  const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

  async function signIn(app: ReturnType<typeof createApp>, email: string) {
    const login = (await (
      await app.request(
        '/api/auth/login',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        },
        env,
      )
    ).json()) as { link: string };
    const token = new URL(login.link).searchParams.get('token') as string;
    const res = await app.request(`/api/auth/verify?token=${token}`, {}, env);
    return (res.headers.get('set-cookie') ?? '').split(';')[0] as string;
  }

  /** A meal with a stored photo, owned by whoever `cookie` is. */
  async function mealWithPhoto(
    app: ReturnType<typeof createApp>,
    cookie: string,
    bytes: Uint8Array = BYTES,
  ) {
    const res = await app.request(
      '/api/meals',
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          meal: {
            foods: [
              {
                food: { name: 'rice', estimatedWeightG: 100, quantity: 1, confidence: 0.9 },
                nutrition: { energyKcal: 100, proteinG: 1, carbsG: 1, fatG: 1, source: 'table' },
              },
            ],
            total: { energyKcal: 100, proteinG: 1, carbsG: 1, fatG: 1, source: 'table' },
            confidence: 0.9,
            needsConfirmation: false,
          },
        }),
      },
      env,
    );
    const id = ((await res.json()) as { id: string }).id;
    const key = photoKey(id);
    await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
    const owner = (await (await app.request('/api/me', { headers: { cookie } }, env)).json()) as {
      userId: string;
    };
    await setMealPhoto(
      createMealsDb(env.DB),
      id,
      owner.userId,
      key,
      'image/jpeg',
      bytes.byteLength,
    );
    return id;
  }

  it('gives the owner their bytes, not a 401', async () => {
    const app = createApp();
    const cookie = await signIn(app, 'photo-owner@example.com');
    const id = await mealWithPhoto(app, cookie);

    const res = await app.request(`/api/meal-photo/${id}`, { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });

  it('serves a ≤240 px JPEG for ?w=240, while the detail URL stays the original', async () => {
    const app = createApp();
    const cookie = await signIn(app, 'photo-thumb@example.com');
    const original = photoJpeg(1600, 1200);
    const id = await mealWithPhoto(app, cookie, original);

    const thumb = await app.request(`/api/meal-photo/${id}?w=240`, { headers: { cookie } }, env);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/jpeg');
    expect(thumb.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    const etag = thumb.headers.get('etag');
    expect(etag).toMatch(/^"[^"]+"$/);
    const thumbBytes = new Uint8Array(await thumb.arrayBuffer());
    // The length is declared, not left to chunked transfer.
    expect(thumb.headers.get('content-length')).toBe(String(thumbBytes.length));
    const dims = jpegDimensions(thumbBytes);
    expect(Math.max(dims.width, dims.height)).toBe(240);
    expect(thumbBytes.length).toBeLessThan(original.length);

    // No `?w=` means the stored original, byte for byte: the detail screen is
    // never silently downscaled. It keeps the shorter life and its own ETag.
    const full = await app.request(`/api/meal-photo/${id}`, { headers: { cookie } }, env);
    expect(full.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(full.headers.get('etag')).toBeTruthy();
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(original);
  });

  it('answers a matching if-none-match with 304 and no body', async () => {
    const app = createApp();
    const cookie = await signIn(app, 'photo-304@example.com');
    const id = await mealWithPhoto(app, cookie, photoJpeg(1600, 1200));

    const first = await app.request(`/api/meal-photo/${id}?w=240`, { headers: { cookie } }, env);
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    await first.arrayBuffer();

    const second = await app.request(
      `/api/meal-photo/${id}?w=240`,
      { headers: { cookie, 'if-none-match': etag as string } },
      env,
    );
    expect(second.status).toBe(304);
    expect(second.headers.get('etag')).toBe(etag);
    expect(second.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect((await second.arrayBuffer()).byteLength).toBe(0);

    // A different validator is a miss: the bytes still come back.
    const third = await app.request(
      `/api/meal-photo/${id}?w=240`,
      { headers: { cookie, 'if-none-match': '"not-the-one"' } },
      env,
    );
    expect(third.status).toBe(200);
    expect((await third.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it('answers HEAD with the same validators and no body (the curl -I path)', async () => {
    const app = createApp();
    const cookie = await signIn(app, 'photo-head@example.com');
    const id = await mealWithPhoto(app, cookie, photoJpeg(1600, 1200));

    const res = await app.request(
      `/api/meal-photo/${id}?w=240`,
      { method: 'HEAD', headers: { cookie } },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(res.headers.get('etag')).toMatch(/^"[^"]+"$/);
    expect(res.headers.get('content-length')).toBeTruthy();
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it('lists a stored-photo meal as hasPhoto (no Telegram file id), and a manual one as not', async () => {
    const app = createApp();
    const cookie = await signIn(app, 'photo-list@example.com');
    const withPhoto = await mealWithPhoto(app, cookie);
    const manual = (await (
      await app.request(
        '/api/meals',
        {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({
            meal: {
              foods: [
                {
                  food: { name: 'tea', estimatedWeightG: 100, quantity: 1, confidence: 0.9 },
                  nutrition: { energyKcal: 5, proteinG: 0, carbsG: 1, fatG: 0, source: 'table' },
                },
              ],
              total: { energyKcal: 5, proteinG: 0, carbsG: 1, fatG: 0, source: 'table' },
              confidence: 0.9,
              needsConfirmation: false,
            },
          }),
        },
        env,
      )
    ).json()) as { id: string };

    const list = (await (await app.request('/api/meals', { headers: { cookie } }, env)).json()) as {
      meals: Array<{ id: string; hasPhoto: boolean }>;
    };
    const flag = (id: string) => list.meals.find((m) => m.id === id)?.hasPhoto;
    expect(flag(withPhoto)).toBe(true);
    expect(flag(manual.id)).toBe(false);
  });

  it('still 401s with no credentials, and 404s for someone else’s meal', async () => {
    const app = createApp();
    const owner = await signIn(app, 'photo-owner2@example.com');
    const other = await signIn(app, 'photo-other@example.com');
    const id = await mealWithPhoto(app, owner);

    expect((await app.request(`/api/meal-photo/${id}`, {}, env)).status).toBe(401);
    expect(
      (await app.request(`/api/meal-photo/${id}`, { headers: { cookie: other } }, env)).status,
    ).toBe(404);
  });

  it('works for an anonymous device account, and a bogus device cookie mints nothing', async () => {
    const app = createApp();
    const first = await app.request('/api/meals', {}, env);
    const device = (first.headers.get('set-cookie') ?? '').split(';')[0] as string;
    const id = await mealWithPhoto(app, device);
    expect(
      (await app.request(`/api/meal-photo/${id}`, { headers: { cookie: device } }, env)).status,
    ).toBe(200);

    const count = async () =>
      (await env.DB.prepare('select count(*) n from users').first<{ n: number }>())?.n;
    const before = await count();
    const bogus = await app.request(
      `/api/meal-photo/${id}`,
      { headers: { cookie: 'sb_device=dev_nope' } },
      env,
    );
    expect(bogus.status).toBe(401);
    expect(await count()).toBe(before);
  });
});

describe('POST /api/meals photo upload limits', () => {
  it('rejects a 3 MB base64 photo before decoding it, leaving no meal behind', async () => {
    const tgId = 9101;
    const app = createApp();
    const headers = {
      [INIT_DATA_HEADER]: await initFor(tgId),
      'content-type': 'application/json',
    };

    const res = await app.request(
      '/api/meals',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          meal: MEAL,
          photo: { base64: 'A'.repeat(3 * 1024 * 1024), mimeType: 'image/jpeg' },
        }),
      },
      env,
    );
    expect(res.status).toBe(413);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/too large/i);

    const list = (await (await app.request('/api/meals', { headers }, env)).json()) as {
      meals: unknown[];
    };
    expect(list.meals).toEqual([]);
  });

  it('stores the browser-compressed photo as sent, without a server re-encode', async () => {
    const tgId = 9102;
    const app = createApp();
    const initData = await initFor(tgId);
    const headers = { [INIT_DATA_HEADER]: initData, 'content-type': 'application/json' };

    // The Mini App compresses in the browser before upload. The server must
    // store those bytes verbatim: a second Photon decode would only burn CPU.
    const original = photoJpeg(2000, 1500, { noise: 60, quality: 82 });
    expect(original.length).toBeGreaterThan(400 * 1024);
    expect(toBase64(original).length).toBeLessThan(2 * 1024 * 1024);

    const saved = await app.request(
      '/api/meals',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          meal: MEAL,
          photo: { base64: toBase64(original), mimeType: 'image/jpeg' },
        }),
      },
      env,
    );
    expect(saved.status).toBe(201);
    const { id } = (await saved.json()) as { id: string };

    const photo = await app.request(
      `/api/meal-photo/${id}?initData=${encodeURIComponent(initData)}`,
      {},
      env,
    );
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/jpeg');
    const stored = new Uint8Array(await photo.arrayBuffer());
    expect(stored).toEqual(original);
    const dims = jpegDimensions(stored);
    expect(dims.width).toBe(2000);
    expect(dims.height).toBe(1500);
  });

  it('rejects a body over 10 MB from its Content-Length without parsing it', async () => {
    const app = createApp();
    const res = await app.request(
      new Request('http://local/api/meals', {
        method: 'POST',
        headers: {
          [INIT_DATA_HEADER]: await initFor(9103),
          'content-type': 'application/json',
          'content-length': String(11 * 1024 * 1024),
        },
        body: '{}',
      }),
      {},
      env,
    );
    expect(res.status).toBe(413);
  });
});
