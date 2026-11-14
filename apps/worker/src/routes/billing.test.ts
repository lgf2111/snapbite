import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { getAccount } from '../billing/accounts.js';
import { PACKS } from '../billing/packs.js';
import { createAuthDb, createSession } from '../db/auth.js';
import { googleSignIn } from '../test/googleSignIn.js';

const ADMIN_TOKEN = 'stage-3-admin-token';
const WEBHOOK_SECRET = 'whsec_stage3_test';

const app = () => createApp();
const email = () => `${crypto.randomUUID()}@example.com`;

/** A verified user with a real session row, without going through sign-in. */
async function verifiedSession(address = email()) {
  const userId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO users (id, email, email_verified_at, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(userId, address, Date.now(), Date.now())
    .run();
  const raw = await createSession(createAuthDb(env.DB), userId, 'google');
  return { userId, email: address, cookie: `sb_session=${raw}` };
}

async function json(
  path: string,
  init: RequestInit,
  cookie?: string,
  e: object = env,
): Promise<Response> {
  return app().request(
    path,
    {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
    },
    e as typeof env,
  );
}

async function hexHmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  let out = '';
  for (const byte of new Uint8Array(mac)) out += byte.toString(16).padStart(2, '0');
  return out;
}

async function signedStripeEvent(event: unknown, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await hexHmac(secret, `${timestamp}.${payload}`);
  return { payload, signature: `t=${timestamp},v1=${signature}` };
}

function checkoutEvent(opts: {
  id: string;
  email: string;
  pack?: string;
  amount?: number;
  currency?: string;
  paymentStatus?: string;
}) {
  return {
    id: opts.id,
    type: 'checkout.session.completed',
    data: {
      object: {
        payment_status: opts.paymentStatus ?? 'paid',
        amount_total: opts.amount ?? 499,
        currency: opts.currency ?? 'usd',
        metadata: { email: opts.email, pack: opts.pack ?? 'starter' },
      },
    },
  };
}

async function postWebhook(payload: string, signature: string | null, e: object = env) {
  return app().request(
    '/api/billing/webhook',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(signature ? { 'stripe-signature': signature } : {}),
      },
      body: payload,
    },
    e as typeof env,
  );
}

async function eventCount(id: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM billing_events WHERE id = ?')
    .bind(id)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('trial on verified sign-in', () => {
  it('grants 20 credits and the supporter tag exactly once per email', async () => {
    const address = email();
    const { cookie } = await googleSignIn(app(), address);

    const account = await getAccount(env.DB, address);
    expect(account?.credits).toBe(20);
    expect(account?.supporterSince).toBeNull();
    expect(account?.trialGrantedAt).not.toBeNull();
    expect(account?.trialUntil).toBeGreaterThan(Date.now());

    const summary = (await (
      await json('/api/billing/summary', { method: 'GET' }, cookie)
    ).json()) as {
      signedIn: boolean;
      supporter: boolean;
      credits: number;
      source: string;
      trialAvailable: boolean;
    };
    expect(summary).toMatchObject({
      signedIn: true,
      supporter: true,
      credits: 20,
      source: 'trial',
      trialAvailable: false,
    });

    // The explicit endpoint cannot double-grant either.
    const again = (await (await json('/api/billing/trial', { method: 'POST' }, cookie)).json()) as {
      granted: boolean;
    };
    expect(again.granted).toBe(false);
    expect((await getAccount(env.DB, address))?.credits).toBe(20);

    // A second sign-in with the same verified address is still the same trial.
    await googleSignIn(app(), address);
    expect((await getAccount(env.DB, address))?.credits).toBe(20);

    const me = (await (await json('/api/me', { method: 'GET' }, cookie)).json()) as {
      supporter: boolean;
      credits: number;
    };
    expect(me).toMatchObject({ supporter: true, credits: 20 });
  });

  it('refuses the trial for an anonymous account', async () => {
    const res = await json('/api/billing/trial', { method: 'POST' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/billing/summary', () => {
  it('works for an anonymous account and lists the server packs', async () => {
    const res = await json('/api/billing/summary', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      signedIn: boolean;
      credits: number;
      supporter: boolean;
      packs: Array<{ id: string; credits: number; priceCents: number }>;
    };
    expect(body).toMatchObject({ signedIn: false, credits: 0, supporter: false });
    expect(body.packs).toEqual(
      PACKS.map(({ id, label, credits, priceCents, currency }) => ({
        id,
        label,
        credits,
        priceCents,
        currency,
      })),
    );
  });
});

describe('POST /api/billing/settings', () => {
  it('turns credit overflow off and reports it in the summary', async () => {
    const user = await verifiedSession();
    const res = await json(
      '/api/billing/settings',
      { method: 'POST', body: JSON.stringify({ overflowEnabled: false }) },
      user.cookie,
    );
    expect(res.status).toBe(200);
    expect((await getAccount(env.DB, user.email))?.overflowEnabled).toBe(false);

    const summary = (await (
      await json('/api/billing/summary', { method: 'GET' }, user.cookie)
    ).json()) as { overflowEnabled: boolean };
    expect(summary.overflowEnabled).toBe(false);
  });

  it('rejects a non-boolean body and an anonymous caller', async () => {
    const user = await verifiedSession();
    const bad = await json(
      '/api/billing/settings',
      { method: 'POST', body: JSON.stringify({ overflowEnabled: 'yes' }) },
      user.cookie,
    );
    expect(bad.status).toBe(400);

    const anon = await json('/api/billing/settings', {
      method: 'POST',
      body: JSON.stringify({ overflowEnabled: true }),
    });
    expect(anon.status).toBe(403);
  });
});

describe('POST /api/billing/checkout', () => {
  it('503s without STRIPE_SECRET_KEY and never reaches Stripe', async () => {
    const user = await verifiedSession();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await json(
      '/api/billing/checkout',
      { method: 'POST', body: JSON.stringify({ pack: 'starter' }) },
      user.cookie,
    );
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown pack before calling Stripe', async () => {
    const user = await verifiedSession();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await json(
      '/api/billing/checkout',
      { method: 'POST', body: JSON.stringify({ pack: 'free-money' }) },
      user.cookie,
      { ...env, STRIPE_SECRET_KEY: 'sk_test_123' },
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the server price and credit count, ignoring client-supplied amounts', async () => {
    const user = await verifiedSession();
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test', id: 'cs' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await json(
      '/api/billing/checkout',
      {
        method: 'POST',
        body: JSON.stringify({ pack: 'starter', credits: 999_999, priceCents: 1 }),
      },
      user.cookie,
      { ...env, STRIPE_SECRET_KEY: 'sk_test_123' },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ url: 'https://checkout.stripe.com/c/pay/cs_test' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk_test_123');
    const form = new URLSearchParams(String(init.body));
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('499');
    expect(form.get('line_items[0][price_data][product_data][name]')).toContain('100 analyses');
    expect(form.get('metadata[pack]')).toBe('starter');
    expect(form.get('metadata[email]')).toBe(user.email);
    expect(form.get('client_reference_id')).toBe(user.email);
    expect(String(init.body)).not.toContain('999999');
  });

  it('requires a verified account', async () => {
    const res = await json('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ pack: 'starter' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/billing/webhook', () => {
  it('rejects a bad signature without recording the event', async () => {
    const id = `evt_${crypto.randomUUID()}`;
    const event = checkoutEvent({ id, email: email() });
    const { payload, signature } = await signedStripeEvent(event);
    const wrong = `${signature.split(',')[0]},v1=${'0'.repeat(64)}`;

    const res = await postWebhook(payload, wrong, {
      ...env,
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    });
    expect(res.status).toBe(400);
    expect(await eventCount(id)).toBe(0);
  });

  it('grants credits and the supporter tag once, then ignores the duplicate', async () => {
    const address = email();
    const id = `evt_${crypto.randomUUID()}`;
    const { payload, signature } = await signedStripeEvent(checkoutEvent({ id, email: address }));
    const e = { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET };

    const first = await postWebhook(payload, signature, e);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: true, applied: true });

    const account = await getAccount(env.DB, address);
    expect(account?.credits).toBe(100);
    expect(account?.supporterSince).not.toBeNull();

    const second = await postWebhook(payload, signature, e);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true, applied: false });
    expect((await getAccount(env.DB, address))?.credits).toBe(100);
  });

  it('applies a valid event that was recorded but never applied', async () => {
    const address = email();
    const id = `evt_${crypto.randomUUID()}`;
    const { payload, signature } = await signedStripeEvent(checkoutEvent({ id, email: address }));
    const e = { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET };

    // The previous delivery crashed after the event insert, before the grant.
    await env.DB.prepare(
      `INSERT INTO billing_events (id, type, received_at, applied_at, payload_hash)
       VALUES (?, 'checkout.session.completed', ?, NULL, 'crashed')`,
    )
      .bind(id, Date.now())
      .run();

    const res = await postWebhook(payload, signature, e);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true, applied: true });
    expect((await getAccount(env.DB, address))?.credits).toBe(100);
  });

  it('records but does not grant an unpaid, mismatched or non-checkout event', async () => {
    const address = email();
    const e = { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET };

    for (const event of [
      checkoutEvent({ id: `evt_${crypto.randomUUID()}`, email: address, paymentStatus: 'unpaid' }),
      checkoutEvent({ id: `evt_${crypto.randomUUID()}`, email: address, amount: 1 }),
      checkoutEvent({ id: `evt_${crypto.randomUUID()}`, email: address, pack: 'free-money' }),
      {
        id: `evt_${crypto.randomUUID()}`,
        type: 'payment_intent.succeeded',
        data: { object: { metadata: { email: address, pack: 'starter' } } },
      },
    ]) {
      const { payload, signature } = await signedStripeEvent(event);
      const res = await postWebhook(payload, signature, e);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ applied: false });
      expect(await eventCount(event.id)).toBe(1);
    }

    expect((await getAccount(env.DB, address))?.credits ?? 0).toBe(0);
  });

  it('records an event but never applies it when the signing secret is unset', async () => {
    const address = email();
    const id = `evt_${crypto.randomUUID()}`;
    const { payload } = await signedStripeEvent(checkoutEvent({ id, email: address }));

    const res = await postWebhook(payload, null, { ...env, STRIPE_WEBHOOK_SECRET: undefined });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, applied: false });
    expect(await eventCount(id)).toBe(1);
    expect((await getAccount(env.DB, address))?.credits ?? 0).toBe(0);
  });

  it('does not create an account for Stripe', async () => {
    const id = `evt_${crypto.randomUUID()}`;
    const { payload, signature } = await signedStripeEvent(checkoutEvent({ id, email: email() }));
    const e = { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET };

    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
    await postWebhook(payload, signature, e);
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });
});

describe('POST /api/admin/topup', () => {
  const topup = (token: string | null, body: unknown, e: object = { ...env, ADMIN_TOKEN }) =>
    app().request(
      '/api/admin/topup',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token === null ? {} : { 'x-admin-token': token }),
        },
        body: JSON.stringify(body),
      },
      e as typeof env,
    );

  it('401s without the token and 503s when ADMIN_TOKEN is unset', async () => {
    expect((await topup(null, { email: email(), credits: 10 })).status).toBe(401);
    expect((await topup('wrong', { email: email(), credits: 10 })).status).toBe(401);
    expect(
      (await topup(null, { email: email(), credits: 10 }, { ...env, ADMIN_TOKEN: undefined }))
        .status,
    ).toBe(503);
  });

  it('adds credits without granting the supporter tag', async () => {
    const address = email();
    const res = await topup(ADMIN_TOKEN, { email: address, credits: 50 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, email: address, credits: 50 });

    const account = await getAccount(env.DB, address);
    expect(account?.credits).toBe(50);
    expect(account?.supporterSince).toBeNull();
  });

  it('rejects zero, negative, fractional and missing amounts', async () => {
    for (const credits of [0, -5, 1.5, '10', undefined]) {
      const res = await topup(ADMIN_TOKEN, { email: email(), credits });
      expect(res.status, String(credits)).toBe(400);
    }
  });
});
