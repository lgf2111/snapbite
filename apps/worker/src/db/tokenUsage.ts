/**
 * Per-token request counters for `/api/shortcut/log`.
 *
 * One row per (token, UTC hour). The upsert increments only while the count is
 * under the limit, so a rejected request does not keep writing, and the caller
 * learns the verdict from `meta.changes` without a second read. Rows are tiny
 * and old hours are pruned by the cron.
 */

/** A human logging meals sends a handful an hour; a script would send hundreds. */
export const SHORTCUT_REQUESTS_PER_HOUR = 30;

const HOUR_MS = 60 * 60 * 1000;

/** Fixed UTC hour bucket. */
export function hourBucket(now = Date.now()): number {
  return Math.floor(now / HOUR_MS);
}

/**
 * Counts one request against the token's current hour and returns whether it
 * is allowed. Atomic: two concurrent requests cannot both take the last slot.
 */
export async function consumeTokenRequest(
  d1: D1Database,
  tokenId: string,
  limit = SHORTCUT_REQUESTS_PER_HOUR,
  now = Date.now(),
): Promise<boolean> {
  const result = await d1
    .prepare(
      `INSERT INTO token_usage (token_id, hour_bucket, count)
       VALUES (?, ?, 1)
       ON CONFLICT (token_id, hour_bucket) DO UPDATE SET count = count + 1
       WHERE token_usage.count < ?`,
    )
    .bind(tokenId, hourBucket(now), limit)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Drops buckets that can no longer be current. Best-effort. */
export async function pruneTokenUsage(d1: D1Database, beforeBucket: number): Promise<void> {
  try {
    await d1.prepare('DELETE FROM token_usage WHERE hour_bucket < ?').bind(beforeBucket).run();
  } catch {
    // Never let housekeeping fail the cron.
  }
}
