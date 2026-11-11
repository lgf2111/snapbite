import { env } from 'cloudflare:test';
import { signInitData } from '@snapbite/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';

const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';

async function authHeaders(tgId: number): Promise<Record<string, string>> {
  const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  return {
    [INIT_DATA_HEADER]: await signInitData({ user, auth_date: authDate }, BOT_TOKEN),
    'content-type': 'application/json',
  };
}

interface Minted {
  id: string;
  token: string;
  label: string;
  createdAt: number;
}

async function mint(app: ReturnType<typeof createApp>, tgId: number, body: unknown = {}) {
  return app.request(
    '/api/tokens',
    { method: 'POST', headers: await authHeaders(tgId), body: JSON.stringify(body) },
    env,
  );
}

async function list(app: ReturnType<typeof createApp>, tgId: number, query = '') {
  const res = await app.request(`/api/tokens${query}`, { headers: await authHeaders(tgId) }, env);
  return (await res.json()) as {
    tokens: Array<Record<string, unknown> & { id: string; revokedAt: number | null }>;
  };
}

function ping(app: ReturnType<typeof createApp>, token: string) {
  return app.request('/api/shortcut/ping', { headers: { authorization: `Bearer ${token}` } }, env);
}

describe('device token routes', () => {
  it('creates a token that starts with sb_ and shows up as a row', async () => {
    const app = createApp();
    const res = await mint(app, 8301);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Minted;
    expect(body.token.startsWith('sb_')).toBe(true);
    expect(body.label).toBe('iOS Shortcut');

    const { tokens } = await list(app, 8301);
    expect(tokens.map((t) => t.id)).toContain(body.id);
  });

  it('trims the label, defaults an empty one, and rejects an over-long one', async () => {
    const app = createApp();
    const named = (await (await mint(app, 8302, { label: '  Kitchen iPad  ' })).json()) as Minted;
    expect(named.label).toBe('Kitchen iPad');
    const blank = (await (await mint(app, 8302, { label: '   ' })).json()) as Minted;
    expect(blank.label).toBe('iOS Shortcut');
    expect((await mint(app, 8302, { label: 'x'.repeat(61) })).status).toBe(400);
    expect((await mint(app, 8302, { label: 42 })).status).toBe(400);
  });

  it('never lists the raw token or the hash, newest first', async () => {
    const app = createApp();
    const a = (await (await mint(app, 8303)).json()) as Minted;
    // createdAt is ms; make sure the second row sorts strictly after the first.
    await new Promise((r) => setTimeout(r, 5));
    const b = (await (await mint(app, 8303)).json()) as Minted;

    const { tokens } = await list(app, 8303);
    expect(tokens.map((t) => t.id)).toEqual([b.id, a.id]);
    const serialised = JSON.stringify(tokens);
    expect(serialised).not.toContain(a.token);
    expect(serialised).not.toContain(b.token);
    for (const t of tokens) {
      expect(Object.keys(t).sort()).toEqual([
        'createdAt',
        'id',
        'label',
        'lastUsedAt',
        'revokedAt',
      ]);
    }
  });

  it('revokes one token, hides it by default, and shows it with includeRevoked=1', async () => {
    const app = createApp();
    const t = (await (await mint(app, 8304)).json()) as Minted;
    const del = await app.request(
      `/api/tokens/${t.id}`,
      { method: 'DELETE', headers: await authHeaders(8304) },
      env,
    );
    expect(del.status).toBe(200);

    expect((await list(app, 8304)).tokens).toHaveLength(0);
    const all = (await list(app, 8304, '?includeRevoked=1')).tokens;
    expect(all).toHaveLength(1);
    expect(all[0]?.revokedAt).toEqual(expect.any(Number));
  });

  it("cannot revoke another account's token (404) and leaves it working", async () => {
    const app = createApp();
    const mine = (await (await mint(app, 8305)).json()) as Minted;
    await mint(app, 8306);

    const res = await app.request(
      `/api/tokens/${mine.id}`,
      { method: 'DELETE', headers: await authHeaders(8306) },
      env,
    );
    expect(res.status).toBe(404);
    expect((await ping(app, mine.token)).status).toBe(200);
    expect((await list(app, 8305)).tokens).toHaveLength(1);
  });

  it('answers 404 for an id that does not exist', async () => {
    const app = createApp();
    const res = await app.request(
      '/api/tokens/nope',
      { method: 'DELETE', headers: await authHeaders(8307) },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("revokes every token for the user and not another user's", async () => {
    const app = createApp();
    await mint(app, 8308);
    await mint(app, 8308);
    const other = (await (await mint(app, 8309)).json()) as Minted;

    const res = await app.request(
      '/api/tokens',
      { method: 'DELETE', headers: await authHeaders(8308) },
      env,
    );
    expect(await res.json()).toEqual({ revoked: 2 });
    expect((await list(app, 8308)).tokens).toHaveLength(0);
    expect((await ping(app, other.token)).status).toBe(200);
  });

  it('a revoked token stops working against /api/shortcut/ping', async () => {
    const app = createApp();
    const t = (await (await mint(app, 8310)).json()) as Minted;
    expect((await ping(app, t.token)).status).toBe(200);

    await app.request(
      `/api/tokens/${t.id}`,
      { method: 'DELETE', headers: await authHeaders(8310) },
      env,
    );
    expect((await ping(app, t.token)).status).toBe(401);
  });
});
