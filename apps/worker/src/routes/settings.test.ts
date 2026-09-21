import { signInitData } from '@snapbite/core';
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

describe('PUT /api/settings/profile', () => {
  const profile = {
    sex: 'male',
    age: 30,
    heightCm: 180,
    weightKg: 80,
    activity: 'moderate',
    goal: 'maintain',
    units: 'metric',
    mode: 'simple',
  };

  it('stores a profile and returns computed targets', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(1201)), 'content-type': 'application/json' };
    const res = await app.request(
      '/api/settings/profile',
      { method: 'PUT', headers, body: JSON.stringify({ profile }) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { targets: { energyKcal: number; proteinG: number } };
    expect(body.targets.energyKcal).toBe(2760);
    expect(body.targets.proteinG).toBe(144);

    // GET now surfaces the profile + targets.
    const get = await app.request('/api/settings', { headers: await authHeaders(1201) }, env);
    const g = (await get.json()) as {
      profile: { goal: string } | null;
      targets: { energyKcal: number } | null;
    };
    expect(g.profile?.goal).toBe('maintain');
    expect(g.targets?.energyKcal).toBe(2760);
  });

  it('rejects an invalid profile', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(1202)), 'content-type': 'application/json' };
    const res = await app.request(
      '/api/settings/profile',
      { method: 'PUT', headers, body: JSON.stringify({ profile: { sex: 'male', age: 5 } }) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('lets a user set a profile before adding an API key', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(1203)), 'content-type': 'application/json' };
    const res = await app.request(
      '/api/settings/profile',
      { method: 'PUT', headers, body: JSON.stringify({ profile }) },
      env,
    );
    expect(res.status).toBe(200);
    const get = await app.request('/api/settings', { headers: await authHeaders(1203) }, env);
    const body = (await get.json()) as { connected: boolean; profile: unknown };
    expect(body.connected).toBe(false);
    expect(body.profile).not.toBeNull();
  });
});

describe('PUT /api/settings/fallback', () => {
  it('stores a fallback key and reports it connected + enabled', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(1301)), 'content-type': 'application/json' };
    await app.request(
      '/api/settings/fallback',
      { method: 'PUT', headers, body: JSON.stringify({ apiKey: 'fb-abcd', aiProvider: 'openai' }) },
      env,
    );
    const res = await app.request('/api/settings', { headers: await authHeaders(1301) }, env);
    const body = (await res.json()) as {
      fallbackConnected: boolean;
      fallbackEnabled: boolean;
      fallbackProvider: string | null;
      fallbackKeyLast4: string | null;
    };
    expect(body.fallbackConnected).toBe(true);
    expect(body.fallbackEnabled).toBe(true);
    expect(body.fallbackProvider).toBe('openai');
    expect(body.fallbackKeyLast4).toBe('abcd');
  });

  it('disabling via { enabled:false } KEEPS the stored key', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(1302)), 'content-type': 'application/json' };
    await app.request(
      '/api/settings/fallback',
      { method: 'PUT', headers, body: JSON.stringify({ apiKey: 'fb-keep', aiProvider: 'openai' }) },
      env,
    );
    // Toggle off.
    await app.request(
      '/api/settings/fallback',
      { method: 'PUT', headers, body: JSON.stringify({ enabled: false }) },
      env,
    );
    const res = await app.request('/api/settings', { headers: await authHeaders(1302) }, env);
    const body = (await res.json()) as { fallbackConnected: boolean; fallbackEnabled: boolean };
    // Still connected (key retained) but not enabled.
    expect(body.fallbackConnected).toBe(true);
    expect(body.fallbackEnabled).toBe(false);
  });

  it('remove:true permanently deletes the fallback', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(1303)), 'content-type': 'application/json' };
    await app.request(
      '/api/settings/fallback',
      { method: 'PUT', headers, body: JSON.stringify({ apiKey: 'fb-gone', aiProvider: 'openai' }) },
      env,
    );
    await app.request(
      '/api/settings/fallback',
      { method: 'PUT', headers, body: JSON.stringify({ remove: true }) },
      env,
    );
    const res = await app.request('/api/settings', { headers: await authHeaders(1303) }, env);
    const body = (await res.json()) as { fallbackConnected: boolean };
    expect(body.fallbackConnected).toBe(false);
  });
});

describe('custom primary provider', () => {
  it('stores a custom base URL + provider and returns it', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(1401)), 'content-type': 'application/json' };
    await app.request(
      '/api/settings',
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          apiKey: 'k-custom',
          aiProvider: 'custom',
          aiModel: 'my-model',
          baseUrl: 'https://my-llm.example.com/v1',
          supportsDetail: true,
        }),
      },
      env,
    );
    const res = await app.request('/api/settings', { headers: await authHeaders(1401) }, env);
    const body = (await res.json()) as {
      aiProvider: string;
      customBaseUrl: string | null;
      customSupportsDetail: boolean;
    };
    expect(body.aiProvider).toBe('custom');
    expect(body.customBaseUrl).toBe('https://my-llm.example.com/v1');
    expect(body.customSupportsDetail).toBe(true);
  });

  it('rejects custom without a valid https base URL (falls back to a preset)', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(1402)), 'content-type': 'application/json' };
    await app.request(
      '/api/settings',
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ apiKey: 'k', aiProvider: 'custom', baseUrl: 'ftp://nope' }),
      },
      env,
    );
    const res = await app.request('/api/settings', { headers: await authHeaders(1402) }, env);
    const body = (await res.json()) as { aiProvider: string; customBaseUrl: string | null };
    expect(body.aiProvider).toBe('gemini'); // fell back to default
    expect(body.customBaseUrl).toBeNull();
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

describe('PUT /api/settings/reminders', () => {
  it('stores enabled + validated times and echoes them back on GET', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(2100)), 'content-type': 'application/json' };
    const res = await app.request(
      '/api/settings/reminders',
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          enabled: true,
          times: { breakfast: '07:30', bogus: 'nope' },
          tzOffsetMinutes: -480,
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reminders: { times: Record<string, string> } };
    expect(body.ok).toBe(true);
    // Valid time kept, malformed one dropped.
    expect(body.reminders.times.breakfast).toBe('07:30');
    expect(body.reminders.times.bogus).toBeUndefined();

    const get = (await (
      await app.request('/api/settings', { headers: await authHeaders(2100) }, env)
    ).json()) as { reminders: { enabled: boolean; tzOffsetMinutes: number } | null };
    expect(get.reminders?.enabled).toBe(true);
    expect(get.reminders?.tzOffsetMinutes).toBe(-480);
  });

  it('snaps off-grid times to the 15-min reminder cron slots', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(2102)), 'content-type': 'application/json' };
    const res = await app.request(
      '/api/settings/reminders',
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          enabled: true,
          // 08:07 -> 08:00, 12:38 -> 12:45 (both off-grid picks).
          times: { breakfast: '08:07', lunch: '12:38' },
          tzOffsetMinutes: 0,
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reminders: { times: Record<string, string> } };
    expect(body.reminders.times.breakfast).toBe('08:00');
    expect(body.reminders.times.lunch).toBe('12:45');
  });

  it('works without an API key (no key required to set reminders)', async () => {
    const app = createApp();
    const headers = { ...(await authHeaders(2101)), 'content-type': 'application/json' };
    const res = await app.request(
      '/api/settings/reminders',
      { method: 'PUT', headers, body: JSON.stringify({ enabled: false, tzOffsetMinutes: 0 }) },
      env,
    );
    expect(res.status).toBe(200);
  });
});
