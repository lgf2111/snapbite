import { signInitData } from '@snapbite/core';
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { INIT_DATA_HEADER } from './middleware/auth.js';

const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';

async function validInitData(userId = 42): Promise<string> {
  const user = JSON.stringify({ id: userId, first_name: 'Ada', username: 'ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  return signInitData({ user, auth_date: authDate }, BOT_TOKEN);
}

describe('worker migrations', () => {
  it('created the expected tables', async () => {
    const res = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all<{ name: string }>();
    const tables = res.results.map((r: { name: string }) => r.name);
    for (const t of ['users', 'settings', 'meals', 'food_items', 'nutrition']) {
      expect(tables).toContain(t);
    }
  });
});

describe('GET /api/health', () => {
  it('is reachable without auth', async () => {
    const app = createApp();
    const res = await app.request('/api/health', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('GET /api/me', () => {
  it('returns the user for valid initData', async () => {
    const app = createApp();
    const res = await app.request(
      '/api/me',
      { headers: { [INIT_DATA_HEADER]: await validInitData(42) } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { telegramUserId: number; username: string; userId: string };
    expect(body.telegramUserId).toBe(42);
    expect(body.username).toBe('ada');
    expect(typeof body.userId).toBe('string');
  });

  it('returns the same app user id on repeat calls (upsert)', async () => {
    const app = createApp();
    const headers = { [INIT_DATA_HEADER]: await validInitData(777) };
    const first = (await (await app.request('/api/me', { headers }, env)).json()) as {
      userId: string;
    };
    const second = (await (await app.request('/api/me', { headers }, env)).json()) as {
      userId: string;
    };
    expect(second.userId).toBe(first.userId);
  });

  it('rejects a missing initData with 401', async () => {
    const app = createApp();
    const res = await app.request('/api/me', {}, env);
    expect(res.status).toBe(401);
  });

  it('rejects a tampered initData with 401', async () => {
    const app = createApp();
    const good = await validInitData(42);
    const tampered = `${good}&user=${encodeURIComponent('{"id":99}')}`;
    const res = await app.request('/api/me', { headers: { [INIT_DATA_HEADER]: tampered } }, env);
    expect(res.status).toBe(401);
  });
});
