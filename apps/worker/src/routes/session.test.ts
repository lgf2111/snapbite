import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mergeSql from '../../scripts/merge-users.sql?raw';
import { createApp } from '../app.js';
import { cookies } from '../auth/cookies.js';
import { orphanTelegramAccounts } from '../db/auth.js';
import { googleSignIn } from '../test/googleSignIn.js';

afterEach(() => vi.unstubAllGlobals());

const profile = {
  sex: 'female',
  age: 30,
  heightCm: 165,
  weightKg: 60,
  activity: 'moderate',
  goal: 'maintain',
};

describe('the session cookie', () => {
  it('carries both Max-Age and Expires, so a webview that ignores one still keeps it', () => {
    const header = cookies.serialise(
      cookies.session,
      'abc',
      { httpOnly: true, sameSite: 'None', secure: true, path: '/' },
      cookies.sessionMaxAge,
    );
    expect(header).toContain('Max-Age=2592000');
    expect(header).toContain('Path=/');
    expect(header).toContain('HttpOnly');
    const expires = /Expires=([^;]+)/.exec(header)?.[1] as string;
    expect(expires).toBeTruthy();
    const days = (new Date(expires).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('expires in the past when it is cleared', () => {
    const header = cookies.serialise(
      cookies.session,
      '',
      { httpOnly: true, sameSite: 'Lax', secure: false, path: '/' },
      0,
    );
    expect(header).toContain('Max-Age=0');
    expect(new Date(/Expires=([^;]+)/.exec(header)?.[1] as string).getTime()).toBe(0);
  });

  it('is what sign-in actually sets', async () => {
    const app = createApp();
    const { setCookie } = await googleSignIn(app, 'persist@example.com');
    expect(setCookie).toMatch(/sb_session=[^;]+/);
    expect(setCookie).toContain('Max-Age=2592000');
    expect(setCookie).toContain('Expires=');
    expect(setCookie).toContain('Path=/');
  });
});

describe('a later launch with only the session cookie', () => {
  it('is still signed in and the server reports the saved profile', async () => {
    const app = createApp();
    const { cookie: session } = await googleSignIn(app, 'relaunch@example.com');

    // Onboarding: the profile is saved under the signed-in account.
    const saved = await app.request(
      '/api/settings/profile',
      {
        method: 'PUT',
        headers: { cookie: session, 'content-type': 'application/json' },
        body: JSON.stringify({ profile }),
      },
      env,
    );
    expect(saved.status).toBe(200);

    // The app is swiped away and reopened: a fresh request, no device cookie, no
    // initData, no localStorage: just what survived.
    const me = (await (
      await app.request('/api/auth/me', { headers: { cookie: session } }, env)
    ).json()) as { signedIn: boolean; email: string };
    expect(me.signedIn).toBe(true);
    expect(me.email).toBe('relaunch@example.com');

    const settings = (await (
      await app.request('/api/settings', { headers: { cookie: session } }, env)
    ).json()) as { profile: { goal: string } | null; targets: unknown };
    expect(settings.profile?.goal).toBe('maintain');
    expect(settings.targets).not.toBeNull();
  });
});

describe('scripts/merge-users.sql', () => {
  const run = async (from: string, into: string) => {
    const sql = mergeSql
      .replace(/^--.*$/gm, '')
      .replaceAll('@FROM', from)
      .replaceAll('@INTO', into);
    for (const stmt of sql
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      await env.DB.prepare(stmt).run();
    }
  };
  const one = async (sql: string, ...args: unknown[]) =>
    (await env.DB.prepare(sql)
      .bind(...args)
      .first<Record<string, number | string | null>>()) ?? {};
  const count = async (table: string, id: string) =>
    (await one(`select count(*) n from ${table} where user_id = ?`, id)).n;

  async function seed(tag: string) {
    const from = `${tag}-from`;
    const into = `${tag}-into`;
    const tg = 7_000_000 + Math.floor(Math.random() * 900_000);
    await env.DB.batch([
      env.DB.prepare('insert into users (id, telegram_user_id, created_at) values (?, ?, 1)').bind(
        from,
        tg,
      ),
      env.DB.prepare('insert into users (id, email, created_at) values (?, ?, 2)').bind(
        into,
        `${tag}@example.com`,
      ),
      env.DB.prepare(
        "insert into settings (user_id, ai_provider, preferences_json, updated_at) values (?, 'openai', '{\"profile\":1}', 1)",
      ).bind(from),
      env.DB.prepare(
        "insert into settings (user_id, ai_provider, updated_at) values (?, 'gemini', 1)",
      ).bind(into),
      env.DB.prepare(
        'insert into meals (id, user_id, created_at, logged_at) values (?, ?, 1, 1)',
      ).bind(`${tag}-m`, from),
      env.DB.prepare("insert into food_items (id, meal_id, name) values (?, ?, 'rice')").bind(
        `${tag}-f`,
        `${tag}-m`,
      ),
      env.DB.prepare(
        "insert into saved_meals (id, user_id, label, meal_json, created_at) values (?, ?, 'x', '{}', 1)",
      ).bind(`${tag}-s`, from),
      env.DB.prepare(
        'insert into sessions (id, user_id, token_hash, created_at, expires_at) values (?, ?, ?, 1, 2)',
      ).bind(`${tag}-se`, from, `${tag}-h`),
      env.DB.prepare(
        'insert into device_tokens (id, user_id, token_hash, created_at) values (?, ?, ?, 1)',
      ).bind(`${tag}-d`, from, `${tag}-dh`),
      env.DB.prepare(
        "insert into push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) values (?, ?, ?, 'p', 'a', 'now')",
      ).bind(`${tag}-p`, from, `https://push.example/${tag}`),
    ]);
    return { from, into, tg };
  }

  it('moves everything to the kept account, hands over the Telegram id, and removes the source', async () => {
    const { from, into, tg } = await seed('merge-a');
    await run(from, into);

    for (const t of [
      'meals',
      'saved_meals',
      'sessions',
      'device_tokens',
      'push_subscriptions',
      'settings',
    ]) {
      expect(await count(t, into), t).toBe(1);
      expect(await count(t, from), `${t} left behind`).toBe(0);
    }
    expect((await one("select count(*) n from food_items where meal_id = 'merge-a-m'")).n).toBe(1);
    // The source's profile replaced the empty one.
    expect((await one('select ai_provider p from settings where user_id = ?', into)).p).toBe(
      'openai',
    );
    const kept = await one('select telegram_user_id t, email e from users where id = ?', into);
    expect(kept.t).toBe(tg);
    expect(kept.e).toBe('merge-a@example.com');
    expect((await one('select count(*) n from users where id = ?', from)).n).toBe(0);
  });

  it('does nothing when either id is unknown or they are the same', async () => {
    const { from, into } = await seed('merge-b');
    await run(from, 'no-such-user');
    await run('no-such-user', into);
    await run(from, from);
    expect((await one('select count(*) n from users where id in (?, ?)', from, into)).n).toBe(2);
    expect(await count('meals', from)).toBe(1);
    expect(await count('meals', into)).toBe(0);
  });
});

describe('orphanTelegramAccounts', () => {
  it('lists Telegram accounts with meals and no email, and only those', async () => {
    await env.DB.batch([
      env.DB.prepare(
        "insert into users (id, telegram_user_id, created_at) values ('orph-a', 7100001, 1)",
      ),
      env.DB.prepare(
        "insert into meals (id, user_id, created_at, logged_at) values ('orph-a-m', 'orph-a', 1, 1)",
      ),
      // Has an email: not an orphan. No meals: nothing to strand. No Telegram id: not a bot account.
      env.DB.prepare(
        "insert into users (id, telegram_user_id, email, created_at) values ('orph-b', 7100002, 'b@example.com', 1)",
      ),
      env.DB.prepare(
        "insert into meals (id, user_id, created_at, logged_at) values ('orph-b-m', 'orph-b', 1, 1)",
      ),
      env.DB.prepare(
        "insert into users (id, telegram_user_id, created_at) values ('orph-c', 7100003, 1)",
      ),
      env.DB.prepare("insert into users (id, created_at) values ('orph-d', 1)"),
      env.DB.prepare(
        "insert into meals (id, user_id, created_at, logged_at) values ('orph-d-m', 'orph-d', 1, 1)",
      ),
    ]);
    const ids = (await orphanTelegramAccounts(env.DB, 100)).map((o) => o.userId);
    expect(ids).toContain('orph-a');
    for (const not of ['orph-b', 'orph-c', 'orph-d']) expect(ids).not.toContain(not);
  });
});
