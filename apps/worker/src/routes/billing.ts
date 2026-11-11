import { type Context, Hono } from 'hono';
import {
  createEntitlementMemo,
  ensureAccount,
  getAccount,
  getEntitlement,
  getVerifiedEmail,
  grantTrial,
  overflowSpentToday,
  setOverflowEnabled,
} from '../billing/accounts.js';
import { PACKS, findPack } from '../billing/packs.js';
import { DAILY_OVERFLOW_CAP } from '../billing/provider.js';
import { looksLikeEmail, normalizeEmail } from '../db/auth.js';
import type { AppBindings } from '../env.js';

/** What the client is allowed to know about billing for this account. */
async function summaryPayload(db: D1Database, userId: string) {
  const entitlement = await getEntitlement(db, userId, createEntitlementMemo());
  const email = await getVerifiedEmail(db, userId);
  const account = email ? await getAccount(db, email) : null;
  const overflowUsedToday = email ? await overflowSpentToday(db, email) : 0;

  return {
    signedIn: email != null,
    email,
    supporter: entitlement.supporter,
    credits: entitlement.credits,
    source: entitlement.source,
    trialUntil: entitlement.trialUntil,
    trialAvailable: account ? account.trialGrantedAt == null : false,
    overflowEnabled: account?.overflowEnabled ?? true,
    overflowUsedToday,
    overflowCap: DAILY_OVERFLOW_CAP,
    packs: PACKS.map(({ id, label, credits, priceCents, currency }) => ({
      id,
      label,
      credits,
      priceCents,
      currency,
    })),
  };
}

/** The 403 answer for a paid action that needs a verified identity. */
function signInRequired(c: Context<AppBindings>) {
  return c.json(
    {
      error: 'Sign in required',
      detail: 'Sign in with a verified email or Google to buy credits and use the trial.',
    },
    403,
  );
}

/**
 * Account billing routes. Mounted under `/api`, so `accountAuth` has already set
 * the user id. Every action that costs or grants money requires a *verified*
 * email: anonymous device accounts stay free, never paid.
 */
export function billingRoutes() {
  const app = new Hono<AppBindings>();

  // GET /api/billing/summary — balance, trial, overflow and the packs.
  app.get('/summary', async (c) => {
    return c.json(await summaryPayload(c.env.DB, c.get('userId')));
  });

  // POST /api/billing/settings — { overflowEnabled: boolean }
  app.post('/settings', async (c) => {
    const email = await getVerifiedEmail(c.env.DB, c.get('userId'));
    if (!email) return signInRequired(c);

    const body = (await c.req.json().catch(() => null)) as { overflowEnabled?: unknown } | null;
    if (typeof body?.overflowEnabled !== 'boolean') {
      return c.json({ error: 'Bad request', detail: 'overflowEnabled must be a boolean' }, 400);
    }

    await setOverflowEnabled(c.env.DB, email, body.overflowEnabled);
    return c.json({ ok: true, overflowEnabled: body.overflowEnabled });
  });

  // POST /api/billing/trial — grant the once-per-identity 20 credits + 14 days.
  app.post('/trial', async (c) => {
    const email = await getVerifiedEmail(c.env.DB, c.get('userId'));
    if (!email) return signInRequired(c);

    const result = await grantTrial(c.env.DB, email);
    return c.json({ ok: true, ...result });
  });

  // POST /api/billing/checkout — { pack } -> { url } for Stripe Checkout.
  app.post('/checkout', async (c) => {
    const email = await getVerifiedEmail(c.env.DB, c.get('userId'));
    if (!email) return signInRequired(c);

    const body = (await c.req.json().catch(() => null)) as { pack?: unknown } | null;
    const pack = findPack(body?.pack);
    if (!pack) {
      return c.json({ error: 'Bad request', detail: 'Unknown credit pack' }, 400);
    }

    const secret = c.env.STRIPE_SECRET_KEY?.trim();
    if (!secret) {
      return c.json(
        {
          error: 'Checkout unavailable',
          detail:
            'Card payments are not configured yet. Add credits with the owner or try again later.',
        },
        503,
      );
    }

    const origin = c.env.APP_ORIGIN ?? new URL(c.req.url).origin;
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: `${origin}/?billing=success`,
      cancel_url: `${origin}/?billing=cancel`,
      customer_email: email,
      client_reference_id: email,
      'metadata[email]': email,
      'metadata[pack]': pack.id,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': pack.currency,
      'line_items[0][price_data][unit_amount]': String(pack.priceCents),
      'line_items[0][price_data][product_data][name]': `SnapBite ${pack.label} — ${pack.credits} analyses`,
      'line_items[0][price_data][product_data][description]':
        'Prepaid AI meal analyses. Any pack also unlocks the supporter tag permanently.',
    });

    try {
      const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${secret}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
      const json = (await res.json().catch(() => null)) as {
        url?: unknown;
        id?: unknown;
        error?: { message?: unknown };
      } | null;

      if (!res.ok || typeof json?.url !== 'string') {
        return c.json(
          {
            error: 'Checkout failed',
            detail:
              typeof json?.error?.message === 'string'
                ? json.error.message
                : 'Stripe rejected the checkout request.',
          },
          502,
        );
      }
      return c.json({ url: json.url, id: typeof json.id === 'string' ? json.id : null });
    } catch {
      return c.json(
        { error: 'Checkout failed', detail: 'Could not reach Stripe. Try again in a moment.' },
        502,
      );
    }
  });

  return app;
}

/* ------------------------------------------------------------------ webhook */

interface StripeEvent {
  id?: unknown;
  type?: unknown;
  data?: { object?: Record<string, unknown> };
}

function bytesToHex(bytes: ArrayBuffer): string {
  let out = '';
  for (const byte of new Uint8Array(bytes)) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Constant-time-enough comparison for two fixed-length hex digests. */
function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies `Stripe-Signature: t=…,v1=…` over `${t}.${rawBody}`, accepting any
 * matching v1 signature (Stripe sends several during secret rotation).
 */
async function validSignature(rawBody: string, header: string, secret: string): Promise<boolean> {
  let timestamp = '';
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (key === 't' && value) timestamp = value;
    if (key === 'v1' && value) signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = bytesToHex(mac);
  let ok = false;
  for (const signature of signatures) ok = equalHex(signature, expected) || ok;
  return ok;
}

/** Reads a string field from the session's metadata object. */
function metaString(object: Record<string, unknown> | undefined, key: string): string | null {
  const metadata = object?.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Stripe webhook. Mounted OUTSIDE account auth: Stripe has no SnapBite account
 * and must not create an anonymous user. Events are recorded idempotently by
 * Stripe event id; only a verified, paid `checkout.session.completed` whose
 * pack/amount match the server's constants grants credits and the supporter tag.
 *
 * Without `STRIPE_WEBHOOK_SECRET` the event is recorded but never applied:
 * an unverified webhook could otherwise be forged to mint credits.
 */
export function billingWebhookRoutes() {
  const app = new Hono<AppBindings>();

  app.post('/webhook', async (c) => {
    const rawBody = await c.req.text();
    const secret = c.env.STRIPE_WEBHOOK_SECRET?.trim();

    if (secret) {
      const header = c.req.header('stripe-signature') ?? '';
      if (!(await validSignature(rawBody, header, secret))) {
        return c.json({ error: 'Invalid signature' }, 400);
      }
    }

    let event: StripeEvent;
    try {
      event = JSON.parse(rawBody) as StripeEvent;
    } catch {
      return c.json({ error: 'Bad request', detail: 'Invalid JSON' }, 400);
    }
    if (typeof event.id !== 'string' || !event.id || typeof event.type !== 'string') {
      return c.json({ error: 'Bad request', detail: 'Not a Stripe event' }, 400);
    }

    const db = c.env.DB;
    const now = Date.now();
    const payloadHash = bytesToHex(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody)),
    );

    const inserted = await db
      .prepare(
        `INSERT INTO billing_events (id, type, received_at, applied_at, payload_hash)
         VALUES (?, ?, ?, NULL, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(event.id, event.type, now, payloadHash)
      .run();

    const duplicate = (inserted.meta?.changes ?? 0) === 0;
    if (duplicate) {
      const existing = await db
        .prepare('SELECT applied_at FROM billing_events WHERE id = ?')
        .bind(event.id)
        .first<{ applied_at: number | null }>();
      // Already granted: Stripe is retrying a delivery we completed.
      if (existing?.applied_at != null) {
        return c.json({ received: true, duplicate: true, applied: false });
      }
      // Recorded but never applied (a crash between insert and grant): fall
      // through and try again. The batch below is still guarded on applied_at.
    }

    if (!secret) {
      console.warn('[billing] STRIPE_WEBHOOK_SECRET is unset; event recorded but not applied');
      return c.json({ received: true, applied: false });
    }

    if (event.type !== 'checkout.session.completed') {
      return c.json({ received: true, applied: false });
    }

    const session = event.data?.object;
    const pack = findPack(metaString(session, 'pack'));
    const rawEmail = metaString(session, 'email');
    const email = rawEmail ? normalizeEmail(rawEmail) : '';
    const paid = session?.payment_status === 'paid';
    const amountMatches = session?.amount_total === pack?.priceCents;
    const currencyMatches = session?.currency === pack?.currency;

    if (
      !session ||
      !pack ||
      !looksLikeEmail(email) ||
      !paid ||
      !amountMatches ||
      !currencyMatches
    ) {
      return c.json({ received: true, applied: false });
    }

    await ensureAccount(db, email);
    const appliedAt = Date.now();
    const ledgerId = crypto.randomUUID();
    const results = await db.batch([
      db
        .prepare('UPDATE billing_events SET applied_at = ? WHERE id = ? AND applied_at IS NULL')
        .bind(appliedAt, event.id),
      db
        .prepare(
          `UPDATE billing_accounts
              SET credits = credits + ?,
                  supporter_since = COALESCE(supporter_since, ?),
                  updated_at = ?
            WHERE email = ? AND changes() = 1`,
        )
        .bind(pack.credits, appliedAt, appliedAt, email),
      db
        .prepare(
          `INSERT INTO credit_ledger (id, email, delta, reason, meal_id, created_at)
           SELECT ?, ?, ?, 'purchase', NULL, ?
            WHERE changes() = 1`,
        )
        .bind(ledgerId, email, pack.credits, appliedAt),
    ]);

    const applied = (results[0]?.meta?.changes ?? 0) > 0;
    return c.json({ received: true, ...(duplicate ? { duplicate: true } : {}), applied });
  });

  return app;
}
