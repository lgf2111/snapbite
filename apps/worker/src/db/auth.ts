import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { deviceTokens, loginTokens, sessions, settings, users } from './schema.js';

/**
 * Email magic-link accounts + server sessions.
 *
 * One `users` row per person (unchanged): `email` is a credential attached to
 * that row, never a peer identity. A Telegram user who signs in by email keeps
 * the same account and therefore the same meals.
 *
 * Tokens are stored hashed and never returned after creation.
 */

export function createAuthDb(d1: D1Database) {
  return drizzle(d1, { schema: { users, settings, sessions, loginTokens, deviceTokens } });
}

export type AuthDb = ReturnType<typeof createAuthDb>;

/** Sessions last 30 days; the cookie is refreshed on use. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A magic link is valid for 15 minutes. */
export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lowercased + trimmed, the only form ever stored or compared. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Loose sanity check — the magic link is the real verification. */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

export async function findUserByEmail(db: AuthDb, email: string) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Returns the account for an email, creating one on first sign-in. A new row
 * gets an empty settings row so BYOK/profile writes have somewhere to land.
 * `telegramUserId` is captured by the migration's rebuild as nullable; accounts
 * created here have no Telegram identity.
 */
export async function ensureUserForEmail(db: AuthDb, email: string) {
  const normalized = normalizeEmail(email);
  const existing = await findUserByEmail(db, normalized);
  if (existing) return { user: existing, created: false };

  const now = Date.now();
  const row = {
    id: crypto.randomUUID(),
    // Raw SQL column default is not available here: telegram ids are required by
    // the old shape and nullable by the new one. Drizzle's insert omits it.
    createdAt: now,
    email: normalized,
    emailVerifiedAt: now,
    lastBroadcastChatId: null,
    lastBroadcastMessageId: null,
    lastBroadcastAt: null,
    lastBroadcastVersion: null,
  };
  await db.insert(users).values(row as never);
  await db
    .insert(settings)
    .values({ userId: row.id, aiProvider: 'gemini', updatedAt: now })
    .onConflictDoNothing();
  return { user: { ...row, telegramUserId: null } as never, created: true };
}

/** Issues a single-use login token and returns the raw value to put in a link. */
export async function issueLoginToken(db: AuthDb, email: string): Promise<string> {
  const raw = randomToken(32);
  const now = Date.now();
  await db.insert(loginTokens).values({
    tokenHash: await sha256Hex(raw),
    email: normalizeEmail(email),
    createdAt: now,
    expiresAt: now + LOGIN_TOKEN_TTL_MS,
  });
  return raw;
}

/**
 * Consumes a login token exactly once. Returns the email it was issued for, or
 * null when it is unknown, already used, or expired.
 */
export async function consumeLoginToken(db: AuthDb, raw: string): Promise<string | null> {
  const hash = await sha256Hex(raw);
  const rows = await db
    .select()
    .from(loginTokens)
    .where(and(eq(loginTokens.tokenHash, hash), isNull(loginTokens.consumedAt)))
    .limit(1);
  const row = rows[0];
  if (!row || row.expiresAt < Date.now()) return null;
  await db
    .update(loginTokens)
    .set({ consumedAt: Date.now() })
    .where(eq(loginTokens.tokenHash, hash));
  return row.email;
}

/** Creates a session row and returns the raw cookie token. */
export type SessionMethod = 'google' | 'email';

export async function createSession(
  db: AuthDb,
  userId: string,
  method?: SessionMethod,
): Promise<string> {
  const raw = randomToken(32);
  const now = Date.now();
  await db.insert(sessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: await sha256Hex(raw),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    method: method ?? null,
  });
  return raw;
}

/** Resolves a session token to its user, or null when unknown/expired. */
export async function findSessionUser(db: AuthDb, raw: string) {
  return (await findSession(db, raw))?.user ?? null;
}

/** Like `findSessionUser`, plus how the session was opened. */
export async function findSession(db: AuthDb, raw: string) {
  if (!raw) return null;
  const hash = await sha256Hex(raw);
  const rows = await db
    .select({
      user: users,
      expiresAt: sessions.expiresAt,
      sessionId: sessions.id,
      method: sessions.method,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }
  return { user: row.user, method: row.method as SessionMethod | null };
}

export async function deleteSession(db: AuthDb, raw: string): Promise<void> {
  if (!raw) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, await sha256Hex(raw)));
}

/* ---------------- anonymous device accounts ---------------- */

/**
 * Finds or creates the account bound to this browser's device token. The token
 * row lives in `device_tokens` (same table the Shortcut uses) with a null label,
 * so an anonymous visitor gets a real `users` row with no email and no Telegram
 * id — everything else about the account is identical.
 */
/** The account bound to this device token, or null. Never creates one. */
export async function findDeviceUser(db: AuthDb, deviceHash: string) {
  const rows = await db
    .select({ user: users })
    .from(deviceTokens)
    .innerJoin(users, eq(users.id, deviceTokens.userId))
    .where(and(eq(deviceTokens.tokenHash, deviceHash), isNull(deviceTokens.revokedAt)))
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function findOrCreateDeviceUser(db: AuthDb, deviceHash: string) {
  const existing = await findDeviceUser(db, deviceHash);
  if (existing) return { user: existing, created: false };

  const now = Date.now();
  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    createdAt: now,
    email: null,
    emailVerifiedAt: null,
    lastBroadcastChatId: null,
    lastBroadcastMessageId: null,
    lastBroadcastAt: null,
    lastBroadcastVersion: null,
  } as never);
  await db
    .insert(settings)
    .values({ userId, aiProvider: 'gemini', updatedAt: now })
    .onConflictDoNothing();
  await db.insert(deviceTokens).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: deviceHash,
    label: 'anonymous',
    createdAt: now,
  });

  const created = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return { user: created[0] ?? null, created: true };
}

/**
 * Attaches an email credential to an existing account (the device's row), so a
 * person who used the app anonymously keeps every meal when they sign in.
 * Refuses when another account already owns that email.
 */
export async function attachEmailToUser(
  db: AuthDb,
  userId: string,
  email: string,
): Promise<{ ok: true } | { ok: false; reason: 'taken' }> {
  const normalized = normalizeEmail(email);
  const owner = await findUserByEmail(db, normalized);
  if (owner && owner.id !== userId) return { ok: false, reason: 'taken' };
  await db
    .update(users)
    .set({ email: normalized, emailVerifiedAt: Date.now() })
    .where(eq(users.id, userId));
  return { ok: true };
}

/**
 * Admin/support backfill: copies a Telegram-hosted photo into R2 so it renders in
 * the web app and survives the bot going away. Idempotent — a meal that already
 * has `photo_key` is skipped.
 */
export interface PhotoBackfillRow {
  id: string;
  userId: string;
  telegramFileId: string;
}

export async function mealsNeedingPhotoBackfill(
  d1: D1Database,
  limit = 20,
): Promise<PhotoBackfillRow[]> {
  const rows = await d1
    .prepare(
      `SELECT id, user_id AS userId, telegram_file_id AS telegramFileId
         FROM meals
        WHERE telegram_file_id IS NOT NULL AND photo_key IS NULL
        ORDER BY logged_at DESC
        LIMIT ?`,
    )
    .bind(limit)
    .all<PhotoBackfillRow>();
  return rows.results ?? [];
}

/**
 * Telegram accounts that have meals but no email. After a restore that predates a
 * `/linkemail`, the person's real account looks exactly like this, while their
 * Google sign-in creates a second, empty one. Nothing ties the two together, so
 * this can only list candidates for an operator to merge (see
 * `scripts/merge-users.sql`); it never decides.
 */
export async function orphanTelegramAccounts(
  d1: D1Database,
  limit = 10,
): Promise<Array<{ userId: string; telegramUserId: number; meals: number }>> {
  const { results } = await d1
    .prepare(
      `select u.id as userId, u.telegram_user_id as telegramUserId,
              (select count(*) from meals m where m.user_id = u.id) as meals
         from users u
        where u.telegram_user_id is not null and u.email is null
          and exists (select 1 from meals m where m.user_id = u.id)
        order by meals desc
        limit ?`,
    )
    .bind(limit)
    .all<{ userId: string; telegramUserId: number; meals: number }>();
  return results;
}
