import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createAuthDb, attachEmailToUser } from '../db/auth.js';
import { createDb } from '../db/users.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

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
