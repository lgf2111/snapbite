import { and, asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { type PushSubscriptionRow, pushSubscriptions } from './schema.js';

export function createPushDb(d1: D1Database) {
  return drizzle(d1, { schema: { pushSubscriptions } });
}

export type PushDb = ReturnType<typeof createPushDb>;

/** Drop a subscription after this many failures in a row. */
export const MAX_PUSH_FAILURES = 5;

export interface NewSubscription {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
  now?: string;
}

/**
 * Store a subscription, keyed by endpoint. Subscribing the same device again
 * updates its row (fresh keys, failures cleared) instead of adding a second one;
 * if the device is now signed in as someone else, the row moves to them.
 */
export async function upsertSubscription(db: PushDb, s: NewSubscription): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insert(pushSubscriptions)
    .values({
      id,
      userId: s.userId,
      endpoint: s.endpoint,
      p256dh: s.p256dh,
      auth: s.auth,
      createdAt: s.now ?? new Date().toISOString(),
      failCount: 0,
      userAgent: s.userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: s.userId,
        p256dh: s.p256dh,
        auth: s.auth,
        userAgent: s.userAgent ?? null,
        failCount: 0,
      },
    });
  const row = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, s.endpoint))
    .limit(1);
  return row[0]?.id ?? id;
}

/** A user's subscriptions, oldest first. */
export async function listSubscriptions(
  db: PushDb,
  userId: string,
): Promise<PushSubscriptionRow[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(asc(pushSubscriptions.createdAt));
}

/** Delete by endpoint, only if it belongs to `userId`. True when a row went. */
export async function deleteSubscriptionForUser(
  db: PushDb,
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const owned = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)))
    .limit(1);
  if (owned.length === 0) return false;
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.id, (owned[0] as { id: string }).id));
  return true;
}

export async function deleteSubscription(db: PushDb, id: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
}

export async function recordPushOk(db: PushDb, id: string, now = new Date().toISOString()) {
  await db
    .update(pushSubscriptions)
    .set({ lastOkAt: now, failCount: 0 })
    .where(eq(pushSubscriptions.id, id));
}

/**
 * Count a failure; at `MAX_PUSH_FAILURES` in a row the subscription is dropped.
 * Returns true when it was dropped.
 */
export async function recordPushFailure(db: PushDb, id: string): Promise<boolean> {
  await db
    .update(pushSubscriptions)
    .set({ failCount: sql`${pushSubscriptions.failCount} + 1` })
    .where(eq(pushSubscriptions.id, id));
  const row = await db
    .select({ failCount: pushSubscriptions.failCount })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.id, id))
    .limit(1);
  if (row[0] && row[0].failCount >= MAX_PUSH_FAILURES) {
    await deleteSubscription(db, id);
    return true;
  }
  return false;
}
