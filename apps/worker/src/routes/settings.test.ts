import { signInitData } from '@foodlog/core';
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createSettingsDb, getSettings } from '../db/settings.js';
import { createDb, upsertUser } from '../db/users.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';

const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';

async function authHeaders(userId: number): Promise<Record<string, string>> {
  const user = JSON.stringify({ id: userId, first_name: 'Ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  return { [INIT_DATA_HEADER]: await signInitData({ user, auth_date: authDate }, BOT_TOKEN) };
}

/** Resolves the app user id for a Telegram id (creating it if needed). */
async function appUserId(tgId: number): Promise<string> {
  const db = createDb(env.DB);
  const row = await upsertUser(db, { id: tgId });
  return row.id;
}

describe('GET /api/settings', () => {
  it('reports not connected before a key is saved', async () => {
    const app = createApp();
    const res = await app.request('/api/settings', { headers: await authHeaders(1001) }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { connected: boolean; keyLast4: string | null };
    expect(body.connected).toBe(false);
    expect(body.keyLast4).toBeNull();
  });
});

describe('PUT /api/settings', () => {
  it('stores the key encrypted and never returns plaintext', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(1002)), 'content-type': 'application/json' };

    const res = await app.request(
      '/api/settings',
      { method: 'PUT', headers, body: JSON.stringify({ apiKey: 'sk-deepseek-secret-ab12' }) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { connected: boolean; keyLast4: string };
    expect(body.connected).toBe(true);
    expect(body.keyLast4).toBe('ab12');
    // The response must not leak the full key.
    expect(JSON.stringify(body)).not.toContain('sk-deepseek-secret-ab12');

    // Stored ciphertext must not equal the plaintext.
    const id = await appUserId(1002);
    const row = await getSettings(createSettingsDb(env.DB), id);
    expect(row?.apiKeyCiphertext).toBeTruthy();
    expect(row?.apiKeyIv).toBeTruthy();
    expect(row?.apiKeyCiphertext).not.toContain('sk-deepseek-secret');
  });

  it('stores and returns the chosen provider + model', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(1099)), 'content-type': 'application/json' };
    await app.request(
      '/api/settings',
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ apiKey: 'k-1234', aiProvider: 'gemini', aiModel: 'gemini-2.5-flash' }),
      },
      env,
    );
    const res = await app.request('/api/settings', { headers: await authHeaders(1099) }, env);
    const body = (await res.json()) as { aiProvider: string; aiModel: string | null };
    expect(body.aiProvider).toBe('gemini');
    expect(body.aiModel).toBe('gemini-2.5-flash');
  });

  it('defaults an unknown provider to gemini', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(1098)), 'content-type': 'application/json' };
    const res = await app.request(
      '/api/settings',
      { method: 'PUT', headers, body: JSON.stringify({ apiKey: 'k', aiProvider: 'bogus' }) },
      env,
    );
    const body = (await res.json()) as { aiProvider: string };
    expect(body.aiProvider).toBe('gemini');
  });

  it('rejects an empty apiKey', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(1003)), 'content-type': 'application/json' };
    const res = await app.request(
      '/api/settings',
      { method: 'PUT', headers, body: JSON.stringify({ apiKey: '  ' }) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('round-trips: GET after PUT reports connected with last4', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(1004)), 'content-type': 'application/json' };
    await app.request(
      '/api/settings',
      { method: 'PUT', headers, body: JSON.stringify({ apiKey: 'sk-xyz-7890' }) },
      env,
    );
    const res = await app.request('/api/settings', { headers: await authHeaders(1004) }, env);
    const body = (await res.json()) as { connected: boolean; keyLast4: string };
    expect(body.connected).toBe(true);
    expect(body.keyLast4).toBe('7890');
  });
});

describe('POST /api/settings/test', () => {
  it('returns 400 when no key is saved', async () => {
    const app = createApp();
    const res = await app.request(
      '/api/settings/test',
      { method: 'POST', headers: await authHeaders(1005) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns ok after a key is saved', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(1006)), 'content-type': 'application/json' };
    await app.request(
      '/api/settings',
      { method: 'PUT', headers, body: JSON.stringify({ apiKey: 'sk-live-1234' }) },
      env,
    );
    const res = await app.request(
      '/api/settings/test',
      { method: 'POST', headers: await authHeaders(1006) },
      env,
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });
  });
});
