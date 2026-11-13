import { and, eq, gte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { analyticsCache } from './schema.js';

export function createAnalyticsCacheDb(d1: D1Database) {
  return drizzle(d1, { schema: { analyticsCache } });
}

export type AnalyticsCacheDb = ReturnType<typeof createAnalyticsCacheDb>;

/**
 * Reads a report computed at or after `notBefore` (the user's local midnight).
 * Best-effort: any storage failure falls through to a fresh computation.
 */
export async function readAnalyticsCache(
  db: AnalyticsCacheDb,
  userId: string,
  range: string,
  notBefore: number,
): Promise<string | null> {
  try {
    const rows = await db
      .select({ payloadJson: analyticsCache.payloadJson })
      .from(analyticsCache)
      .where(
        and(
          eq(analyticsCache.userId, userId),
          eq(analyticsCache.range, range),
          gte(analyticsCache.computedAt, notBefore),
        ),
      )
      .limit(1);
    return rows[0]?.payloadJson ?? null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[analytics_cache] read failed', err);
    return null;
  }
}

/** Stores a report, replacing the previous day's row for this (user, range). */
export async function writeAnalyticsCache(
  db: AnalyticsCacheDb,
  userId: string,
  range: string,
  payloadJson: string,
): Promise<void> {
  try {
    const computedAt = Date.now();
    await db
      .insert(analyticsCache)
      .values({ userId, range, computedAt, payloadJson })
      .onConflictDoUpdate({
        target: [analyticsCache.userId, analyticsCache.range],
        set: { computedAt, payloadJson },
      });
  } catch (err) {
    // A cache write is an optimisation; never fail the report over it.
    // eslint-disable-next-line no-console
    console.error('[analytics_cache] write failed', err);
  }
}
