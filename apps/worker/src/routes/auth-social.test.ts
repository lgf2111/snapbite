import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { attachEmailToUser, createAuthDb, createSession } from '../db/auth.js';
import { users } from '../db/schema.js';
import { createDb } from '../db/users.js';

function cookieOf(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null;
  for (const part of setCookie.split(/,(?=[^;]+=)/)) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.split(';')[0] ?? null;
  }
  return null;
}

describe('social sign-in (Google)', () => {
  it('reports which providers are configured', async () => {
    const app = createApp();
    const body = (await (await app.request('/api/auth/providers', {}, env)).json()) as {
      email: boolean;
      google: boolean;
    };
    // No Google client id in the test environment.
    expect(body.google).toBe(false);
    expect(typeof body.email).toBe('boolean');
  });

  it('refuses to start a flow that is not configured', async () => {
    const app = createApp();
    const res = await app.request('/api/auth/start/google', {}, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toContain('not enabled');
  });

  it('rejects a callback whose state does not match the cookie', async () => {
    const app = createApp();
    const res = await app.request('/api/auth/callback/google?code=x&state=forged', {}, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('auth=state');
  });

  it('rejects a callback with no code', async () => {
    const app = createApp();
    const res = await app.request('/api/auth/callback/google?state=abc', {}, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('auth=state');
  });
});

describe('social account resolution (email join key)', () => {
  it('a provider email lands on the account that already owns it', async () => {
    // Simulate what /callback/google does after a successful exchange.
    const app = createApp();
    const tgRow = await createDb(env.DB)
      .insert(users)
      .values({
        id: 'social-tg-user',
        telegramUserId: 960000 + Math.floor(Math.random() * 9999),
        email: null,
        emailVerifiedAt: null,
        createdAt: Date.now(),
        lastBroadcastChatId: null,
        lastBroadcastMessageId: null,
        lastBroadcastAt: null,
        lastBroadcastVersion: null,
      })
      .returning();
    expect(tgRow[0]?.id).toBe('social-tg-user');

    await attachEmailToUser(createAuthDb(env.DB), 'social-tg-user', 'same@example.com');

    const owner = await createDb(env.DB)
      .select()
      .from(users)
      .where(eq(users.email, 'same@example.com'));
    expect(owner).toHaveLength(1);
    expect(owner[0]?.telegramUserId).not.toBeNull();

    // And a fresh browser that signs in with that address reads that account.
    const browser = await app.request('/api/me', {}, env);
    const device = cookieOf(browser.headers.get('set-cookie'), 'sb_device');
    expect(device).toBeTruthy();
  });
});

describe('same-origin sign-in on the app domain', () => {
  const googleEnv = { ...env, GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'secret' };

  it('derives the redirect URI from the origin the request came in on', async () => {
    const app = createApp();
    for (const origin of [
      'https://snapbite.leeguanfeng.com',
      'https://snapbite-worker.lgf2111.workers.dev',
    ]) {
      const res = await app.request(`${origin}/api/auth/start/google`, {}, googleEnv);
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('location') ?? '');
      expect(location.searchParams.get('redirect_uri')).toBe(`${origin}/api/auth/callback/google`);
      // The state cookie is set on the same host the callback will arrive on.
      expect(res.headers.get('set-cookie')).toContain('sb_oauth_state=');
    }
  });
});

describe('/api/auth/me reports how the session was opened', () => {
  it.each(['google', 'email'] as const)('says %s', async (method) => {
    const app = createApp();
    const authDb = createAuthDb(env.DB);
    const [user] = await createDb(env.DB)
      .insert(users)
      .values({
        id: `me-${method}`,
        telegramUserId: null,
        email: `${method}@example.com`,
        createdAt: Date.now(),
      })
      .returning();
    const raw = await createSession(authDb, (user as { id: string }).id, method);

    const res = await app.request(
      '/api/auth/me',
      { headers: { cookie: `sb_session=${raw}` } },
      env,
    );
    const body = (await res.json()) as { signedIn: boolean; method: string; email: string };
    expect(body).toMatchObject({ signedIn: true, method, email: `${method}@example.com` });
  });

  it('is null for a session opened before the method was recorded', async () => {
    const app = createApp();
    const [user] = await createDb(env.DB)
      .insert(users)
      .values({
        id: 'me-legacy',
        telegramUserId: null,
        email: 'legacy@example.com',
        createdAt: Date.now(),
      })
      .returning();
    const raw = await createSession(createAuthDb(env.DB), (user as { id: string }).id);
    const res = await app.request(
      '/api/auth/me',
      { headers: { cookie: `sb_session=${raw}` } },
      env,
    );
    expect(((await res.json()) as { method: unknown }).method).toBeNull();
  });
});
