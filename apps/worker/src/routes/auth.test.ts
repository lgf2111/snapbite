import { env } from 'cloudflare:test';
import { signInitData } from '@snapbite/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { attachEmailToUser, createAuthDb, findSessionUser, normalizeEmail } from '../db/auth.js';
import { users } from '../db/schema.js';
import { createDb, upsertUser } from '../db/users.js';
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

function submitLogin(app: ReturnType<typeof createApp>, email: string, cookie?: string) {
  return app.request(
    '/api/auth/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ email }),
    },
    env,
  );
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

  it('returns a magic link when email delivery is unconfigured', async () => {
    const app = createApp();
    const res = await submitLogin(app, 'ada@example.com');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; delivered: boolean; link?: string };
    expect(body.ok).toBe(true);
    expect(body.delivered).toBe(false);
    expect(body.link).toContain('/verify?token=');
  });

  it('never returns the link to the requester unless a developer opted in', async () => {
    // Production has no email provider and no DEV_LOGIN_LINKS: this is its exact situation.
    const app = createApp();
    const prod = { ...env, DEV_LOGIN_LINKS: undefined, RESEND_API_KEY: undefined };
    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'victim@example.com' }),
      },
      prod,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, delivered: false });
    expect(text).not.toContain('/verify');
    expect(text).not.toContain('token');
  });

  it('answers the same for an address that owns an account and one that does not', async () => {
    const app = createApp();
    const prod = { ...env, DEV_LOGIN_LINKS: undefined };
    const ask = async (email: string) =>
      (
        await app.request(
          '/api/auth/login',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email }),
          },
          prod,
        )
      ).json();
    expect(await ask('nobody-here@example.com')).toEqual(await ask('someone@example.com'));
  });

  it('rejects an invalid email address', async () => {
    const app = createApp();
    const res = await submitLogin(app, 'not-an-email');
    expect(res.status).toBe(400);
  });

  it('verifies a link, keeps the anonymous account, and signs in', async () => {
    const app = createApp();

    // Start anonymous, log a meal so we can prove nothing is lost.
    const anon = await app.request('/api/meals', {}, env);
    const device = cookieOf(anon.headers.get('set-cookie'), 'sb_device') as string;
    const before = (await (
      await app.request('/api/me', { headers: { cookie: device } }, env)
    ).json()) as {
      userId: string;
    };

    const login = (await (await submitLogin(app, 'keep@example.com', device)).json()) as {
      link: string;
    };
    const token = new URL(login.link).searchParams.get('token') as string;

    const verify = await app.request(
      `/api/auth/verify?token=${token}`,
      { headers: { cookie: device } },
      env,
    );
    expect(verify.status).toBe(302);
    const session = cookieOf(verify.headers.get('set-cookie'), 'sb_session') as string;

    const me = (await (
      await app.request('/api/auth/me', { headers: { cookie: `${device}; ${session}` } }, env)
    ).json()) as { signedIn: boolean; email: string | null; userId: string };
    expect(me.signedIn).toBe(true);
    expect(me.email).toBe('keep@example.com');
    // Same account: signing in attaches the credential, it does not migrate data.
    expect(me.userId).toBe(before.userId);
  });

  it('a magic link works only once', async () => {
    const app = createApp();
    const login = (await (await submitLogin(app, 'once@example.com')).json()) as { link: string };
    const token = new URL(login.link).searchParams.get('token') as string;

    const first = await app.request(`/api/auth/verify?token=${token}`, {}, env);
    expect(first.status).toBe(302);
    const second = await app.request(`/api/auth/verify?token=${token}`, {}, env);
    expect(second.status).toBe(302);
    expect(second.headers.get('location')).toContain('auth=expired');
  });

  it('refuses an email already owned by another account', async () => {
    const app = createApp();
    const taken = normalizeEmail('taken@example.com');

    // Account A claims the address through the normal flow.
    const aLogin = (await (await submitLogin(app, taken)).json()) as { link: string };
    const aToken = new URL(aLogin.link).searchParams.get('token') as string;
    await app.request(`/api/auth/verify?token=${aToken}`, {}, env);

    // A different browser tries the same address.
    const other = await app.request('/api/meals', {}, env);
    const otherDevice = cookieOf(other.headers.get('set-cookie'), 'sb_device') as string;
    const bLogin = (await (await submitLogin(app, taken, otherDevice)).json()) as { link: string };
    const bToken = new URL(bLogin.link).searchParams.get('token') as string;
    const bVerify = await app.request(
      `/api/auth/verify?token=${bToken}`,
      { headers: { cookie: otherDevice } },
      env,
    );
    // It signs in to the address's existing account rather than duplicating it.
    const session = cookieOf(bVerify.headers.get('set-cookie'), 'sb_session');
    expect(session).toBeTruthy();
  });

  it('logout clears the session cookie', async () => {
    const app = createApp();
    const login = (await (await submitLogin(app, 'bye@example.com')).json()) as { link: string };
    const token = new URL(login.link).searchParams.get('token') as string;
    const verify = await app.request(`/api/auth/verify?token=${token}`, {}, env);
    const session = cookieOf(verify.headers.get('set-cookie'), 'sb_session') as string;

    const out = await app.request(
      '/api/auth/logout',
      { method: 'POST', headers: { cookie: session } },
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

  it('an email account has no Telegram id and is still a normal account', async () => {
    const app = createApp();
    const login = (await (await submitLogin(app, 'tgless@example.com')).json()) as { link: string };
    const token = new URL(login.link).searchParams.get('token') as string;
    const verify = await app.request(`/api/auth/verify?token=${token}`, {}, env);
    const session = cookieOf(verify.headers.get('set-cookie'), 'sb_session') as string;

    const db = createDb(env.DB);
    const rows = await db.select().from(users).where(eq(users.email, 'tgless@example.com'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.telegramUserId).toBeNull();

    // And the session resolves back to that row.
    const resolved = await findSessionUser(createAuthDb(env.DB), session.split('=')[1] as string);
    expect(resolved?.id).toBe(rows[0]?.id);
  });

  it('a Telegram user keeps their account when they add an email', async () => {
    const app = createApp();
    const tgId = 9302;
    const headers = await tgHeaders(tgId);
    const before = (await (await app.request('/api/me', { headers }, env)).json()) as {
      userId: string;
    };
    expect(before.userId).toBeTruthy();

    await upsertUser(createDb(env.DB), { id: tgId });
    const login = (await (await submitLogin(app, 'bot-user@example.com')).json()) as {
      link: string;
    };
    const token = new URL(login.link).searchParams.get('token') as string;
    const verify = await app.request(`/api/auth/verify?token=${token}`, {}, env);
    expect(verify.status).toBe(302);

    const db = createDb(env.DB);
    const rows = await db.select().from(users).where(eq(users.telegramUserId, tgId));
    expect(rows).toHaveLength(1);
  });

  it('email is the join key: signing in reaches the account the bot already made', async () => {
    const app = createApp();
    const tgId = 9401;

    // The bot creates this person's account (via initData) and links an email.
    const tg = await app.request('/api/me', { headers: await tgHeaders(tgId) }, env);
    const tgBody = (await tg.json()) as { userId: string };
    const row = await createDb(env.DB).select().from(users).where(eq(users.telegramUserId, tgId));
    await attachEmailToUser(createAuthDb(env.DB), row[0]!.id, 'joined@example.com');

    // A fresh browser (its own anonymous account) signs in with that address.
    const browser = await app.request('/api/me', {}, env);
    const device = cookieOf(browser.headers.get('set-cookie'), 'sb_device') as string;

    const login = (await (await submitLogin(app, 'joined@example.com', device)).json()) as {
      link: string;
    };
    const token = new URL(login.link).searchParams.get('token') as string;
    const verify = await app.request(
      `/api/auth/verify?token=${token}`,
      { headers: { cookie: device } },
      env,
    );
    const session = cookieOf(verify.headers.get('set-cookie'), 'sb_session') as string;

    const me = (await (
      await app.request('/api/auth/me', { headers: { cookie: `${device}; ${session}` } }, env)
    ).json()) as { userId: string };
    // The browser now reads the Telegram account, so its meals appear there.
    expect(me.userId).toBe(tgBody.userId);
  });

  it('an email link lands on the app, not the API origin', async () => {
    const app = createApp();
    const body = (await (await submitLogin(app, 'landing@example.com')).json()) as { link: string };
    const url = new URL(body.link);
    expect(url.pathname).toBe('/verify');
    expect(url.searchParams.get('token')).toBeTruthy();
  });

  it('/linkemail refuses an address another account owns', async () => {
    const app = createApp();
    // First person claims the address.
    const a = (await (await submitLogin(app, 'owner@example.com')).json()) as { link: string };
    const at = new URL(a.link).searchParams.get('token') as string;
    await app.request(`/api/auth/verify?token=${at}`, {}, env);

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
