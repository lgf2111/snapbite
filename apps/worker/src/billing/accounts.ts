/**
 * Billing accounts + entitlement.
 *
 * The account is keyed by verified email, never by a `users.id`: one person can
 * hold a device row, a Telegram row and a Google row. There is deliberately no
 * foreign key from `billing_accounts` to `users`, so deleting an account cannot
 * erase purchase history (or the trial marker that prevents a second grant).
 *
 * Credits are only ever changed through {@link addCredits}, whose balance update
 * and ledger row are one D1 batch (a transaction). The update itself carries the
 * `credits + delta >= 0` guard, so a concurrent spend cannot drive a balance
 * negative and leave a matching ledger row behind.
 */

export type EntitlementSource = 'byok' | 'credits' | 'trial' | 'none';

export interface BillingAccount {
  email: string;
  stripeCustomerId: string | null;
  credits: number;
  supporterSince: number | null;
  trialGrantedAt: number | null;
  trialUntil: number | null;
  overflowEnabled: boolean;
  updatedAt: number;
}

export interface Entitlement {
  supporter: boolean;
  credits: number;
  trialUntil: number | null;
  source: EntitlementSource;
}

/** Per-request memo so one request resolves the same account at most once. */
export type EntitlementMemo = Map<string, Entitlement>;

export function createEntitlementMemo(): EntitlementMemo {
  return new Map();
}

interface AccountRow {
  email: string;
  stripe_customer_id: string | null;
  credits: number;
  supporter_since: number | null;
  trial_granted_at: number | null;
  trial_until: number | null;
  overflow_enabled: number;
  updated_at: number;
}

function toAccount(row: AccountRow): BillingAccount {
  return {
    email: row.email,
    stripeCustomerId: row.stripe_customer_id,
    credits: row.credits,
    supporterSince: row.supporter_since,
    trialGrantedAt: row.trial_granted_at,
    trialUntil: row.trial_until,
    overflowEnabled: row.overflow_enabled !== 0,
    updatedAt: row.updated_at,
  };
}

export async function getAccount(db: D1Database, email: string): Promise<BillingAccount | null> {
  const row = await db
    .prepare('SELECT * FROM billing_accounts WHERE email = ?')
    .bind(email.trim().toLowerCase())
    .first<AccountRow>();
  return row ? toAccount(row) : null;
}

/** Creates the account row if needed. Never changes an existing balance. */
export async function ensureAccount(db: D1Database, email: string): Promise<BillingAccount> {
  const normalized = email.trim().toLowerCase();
  await db
    .prepare(
      `INSERT INTO billing_accounts (email, credits, overflow_enabled, updated_at)
       VALUES (?, 0, 1, ?)
       ON CONFLICT(email) DO NOTHING`,
    )
    .bind(normalized, Date.now())
    .run();
  const account = await getAccount(db, normalized);
  if (!account) throw new Error('Could not create billing account');
  return account;
}

export class InsufficientCredits extends Error {
  override readonly name = 'InsufficientCredits';
  constructor() {
    super('Not enough credits');
  }
}

/**
 * Adds `delta` credits and one ledger row in a single batch. A negative delta
 * below zero throws {@link InsufficientCredits} and writes nothing.
 * Returns the new balance.
 */
export async function addCredits(
  db: D1Database,
  email: string,
  delta: number,
  reason: string,
  mealId?: string | null,
): Promise<number> {
  const normalized = email.trim().toLowerCase();
  await ensureAccount(db, normalized);
  const now = Date.now();
  const ledgerId = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE billing_accounts
            SET credits = credits + ?, updated_at = ?
          WHERE email = ? AND credits + ? >= 0`,
      )
      .bind(delta, now, normalized, delta),
    db
      .prepare(
        `INSERT INTO credit_ledger (id, email, delta, reason, meal_id, created_at)
         SELECT ?, ?, ?, ?, ?, ?
          WHERE changes() = 1`,
      )
      .bind(ledgerId, normalized, delta, reason, mealId ?? null, now),
  ]);

  const changed = results[0]?.meta?.changes ?? 0;
  if (!changed) throw new InsufficientCredits();
  const account = await getAccount(db, normalized);
  return account?.credits ?? 0;
}

interface EntitlementRow {
  email: string | null;
  credits: number | null;
  supporter_since: number | null;
  trial_until: number | null;
  has_key: number;
}

/**
 * The effective entitlement for a user, resolved by the user's verified email.
 * Supporter = bought a pack once OR the registration trial is still running.
 * Credits remain spendable after a trial ends; the tag does not expire.
 */
export async function getEntitlement(
  db: D1Database,
  userId: string,
  memo?: EntitlementMemo,
): Promise<Entitlement> {
  const cached = memo?.get(userId);
  if (cached) return cached;

  const row = await db
    .prepare(
      `SELECT u.email AS email,
              b.credits AS credits,
              b.supporter_since AS supporter_since,
              b.trial_until AS trial_until,
              CASE WHEN s.api_key_ciphertext IS NOT NULL AND s.api_key_iv IS NOT NULL
                   THEN 1 ELSE 0 END AS has_key
         FROM users u
         LEFT JOIN billing_accounts b ON b.email = u.email
         LEFT JOIN settings s ON s.user_id = u.id
        WHERE u.id = ?`,
    )
    .bind(userId)
    .first<EntitlementRow>();

  const now = Date.now();
  const credits = Math.max(0, row?.credits ?? 0);
  const trialUntil = row?.trial_until ?? null;
  const trialActive = trialUntil != null && trialUntil > now;
  const supporter = row?.supporter_since != null || trialActive;
  const source: EntitlementSource =
    row?.has_key === 1 ? 'byok' : trialActive ? 'trial' : credits > 0 ? 'credits' : 'none';

  const value: Entitlement = { supporter, credits, trialUntil, source };
  memo?.set(userId, value);
  return value;
}

/**
 * Marks the account as a supporter (a pack was bought). Never expires and is
 * safe to call twice.
 */
export async function markSupporter(db: D1Database, email: string, at = Date.now()): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await ensureAccount(db, normalized);
  await db
    .prepare(
      `UPDATE billing_accounts
          SET supporter_since = COALESCE(supporter_since, ?), updated_at = ?
        WHERE email = ?`,
    )
    .bind(at, at, normalized)
    .run();
}

/**
 * Grants the one-time registration trial (20 credits + 14 days of supporter) if
 * this email has never had it. The conditional update is the idempotency gate:
 * a second call changes zero rows and writes no ledger row.
 */
export async function grantTrial(
  db: D1Database,
  email: string,
  credits = 20,
  days = 14,
): Promise<{ granted: boolean; trialUntil: number | null }> {
  const normalized = email.trim().toLowerCase();
  await ensureAccount(db, normalized);
  const now = Date.now();
  const until = now + days * 24 * 60 * 60 * 1000;
  const ledgerId = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE billing_accounts
            SET trial_granted_at = ?, trial_until = ?, credits = credits + ?, updated_at = ?
          WHERE email = ? AND trial_granted_at IS NULL`,
      )
      .bind(now, until, credits, now, normalized),
    db
      .prepare(
        `INSERT INTO credit_ledger (id, email, delta, reason, meal_id, created_at)
         SELECT ?, ?, ?, 'trial', NULL, ?
          WHERE changes() = 1`,
      )
      .bind(ledgerId, normalized, credits, now),
  ]);

  const granted = (results[0]?.meta?.changes ?? 0) > 0;
  const account = await getAccount(db, normalized);
  return { granted, trialUntil: account?.trialUntil ?? null };
}

export async function setOverflowEnabled(
  db: D1Database,
  email: string,
  enabled: boolean,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await ensureAccount(db, normalized);
  await db
    .prepare('UPDATE billing_accounts SET overflow_enabled = ?, updated_at = ? WHERE email = ?')
    .bind(enabled ? 1 : 0, Date.now(), normalized)
    .run();
}

export async function setStripeCustomer(
  db: D1Database,
  email: string,
  customerId: string,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await ensureAccount(db, normalized);
  await db
    .prepare('UPDATE billing_accounts SET stripe_customer_id = ?, updated_at = ? WHERE email = ?')
    .bind(customerId, Date.now(), normalized)
    .run();
}

/** Credits spent by overflow in the current UTC day (the 20/day guard). */
export async function overflowSpentToday(db: D1Database, email: string, now = Date.now()) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(-delta), 0) AS spent
         FROM credit_ledger
        WHERE email = ? AND reason = 'overflow' AND created_at >= ?`,
    )
    .bind(email.trim().toLowerCase(), start.getTime())
    .first<{ spent: number }>();
  return row?.spent ?? 0;
}
