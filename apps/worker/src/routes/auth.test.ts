import { env } from 'cloudflare:test';
import { signInitData } from '@snapbite/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createAuthDb, createSession } from '../db/auth.js';
import { users } from '../db/schema.js';
import { createDb } from '../db/users.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';

const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';

async function tgHeaders(tgId: number): Promise<Record<string, string>> {
  const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  return {
    [INIT_DATA_HEADER]: await signInitData({ user, auth_date: authDate }, BOT_TOKEN),
    'content-type': 'application/json',
  };
}

/** Extracts a `name=value` pair from a Set-Cookie header. */
function cookieOf(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null;
  for (const part of setCookie.split(/,(?=[^;]+=)/)) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.split(';')[0] ?? null;
  }
  return null;
}

describe('optional sign-in', () => {
  it('works with no account at all: an anonymous device gets a real account', async () => {
    const app = createApp();
    const first = await app.request('/api/meals', {}, env);
    expect(first.status).toBe(200);

    const device = cookieOf(first.headers.get('set-cookie'), 'sb_device');
    expect(device).toBeTruthy();

    // Same cookie, same account; a new browser gets a different one.
    const again = await app.request('/api/me', { headers: { cookie: device as string } }, env);
    const body = (await again.json()) as { userId: string; signedIn: boolean };
    expect(body.userId).toBeTruthy();
    expect(body.signedIn).toBe(false);

    const fresh = await app.request('/api/me', {}, env);
    const freshBody = (await fresh.json()) as { userId: string };
    expect(freshBody.userId).not.toBe(body.userId);
  });

  it('still rejects a bad bearer token instead of silently going anonymous', async () => {
    const app = createApp();
    const res = await app.request(
      '/api/meals',
      { headers: { authorization: 'Bearer sb_not-real' } },
      env,
    );
    expect(res.status).toBe(401);
  });

  it('logout clears the session cookie', async () => {
    const app = createApp();
    const [user] = await createDb(env.DB)
      .insert(users)
      .values({
        id: 'logout-user',
        telegramUserId: null,
        email: 'bye@example.com',
        createdAt: Date.now(),
      })
      .returning();
    const raw = await createSession(createAuthDb(env.DB), (user as { id: string }).id, 'google');

    const out = await app.request(
      '/api/auth/logout',
      { method: 'POST', headers: { cookie: `sb_session=${raw}` } },
      env,
    );
    expect(out.status).toBe(200);
    const cleared = out.headers.get('set-cookie') ?? '';
    expect(cleared).toContain('sb_session=');
    expect(cleared).toContain('Max-Age=0');
  });

  it('keeps the bot working exactly as before (initData still authenticates)', async () => {
    const app = createApp();
    const tgId = 9301;
    const res = await app.request('/api/me', { headers: await tgHeaders(tgId) }, env);
    const body = (await res.json()) as { telegramUserId: number; signedIn: boolean };
    expect(body.telegramUserId).toBe(tgId);
    expect(body.signedIn).toBe(false);
  });

  it('/linkemail refuses an address another account owns', async () => {
    const app = createApp();
    // The address already belongs to a different account.
    await createDb(env.DB)
      .insert(users)
      .values({
        id: 'linkemail-owner',
        telegramUserId: 9500,
        email: 'owner@example.com',
        emailVerifiedAt: Date.now(),
        createdAt: Date.now(),
      })
      .returning();

    // A second Telegram user tries to claim it.
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-webhook-secret',
        },
        body: JSON.stringify({
          update_id: 1,
          message: {
            message_id: 1,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 9501, type: 'private' },
            from: { id: 9501, first_name: 'Bob' },
            text: '/linkemail owner@example.com',
          },
        }),
      },
      env,
    );
    expect(res.status).toBe(200);

    // No second account may end up owning that address.
    const owners = await createDb(env.DB)
      .select()
      .from(users)
      .where(eq(users.email, 'owner@example.com'));
    expect(owners).toHaveLength(1);
  });
});
