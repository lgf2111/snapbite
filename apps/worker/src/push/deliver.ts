import {
  type PushDb,
  deleteSubscription,
  listSubscriptions,
  recordPushFailure,
  recordPushOk,
} from '../db/push.js';
import type { Env } from '../env.js';
import { isGone, sendPush } from './send.js';

export interface PushFailure {
  status: number;
  /** First 200 characters the push service returned, when it returned a body. */
  bodyPrefix: string | null;
}

export interface DeliverySummary {
  /** Subscriptions the push service accepted. */
  delivered: number;
  /** Subscriptions that failed this time but are still kept. */
  failed: number;
  /** Subscriptions removed (the service said they are gone, or too many failures). */
  removed: number;
  /** Subscriptions still on file for the user afterwards. */
  live: number;
  /** Every refusal this send, for the caller's error log. */
  failures: PushFailure[];
}

/**
 * Send `payload` to every subscription a user has and tidy up after it: a
 * 404/410 deletes the row, other failures count toward dropping it, a success
 * clears the count. Used by the reminder cron and the "send a test" route, so
 * both treat dead subscriptions the same way.
 */
export async function pushToUser(
  db: PushDb,
  userId: string,
  payload: Record<string, unknown>,
  env: Env,
): Promise<DeliverySummary> {
  const subs = await listSubscriptions(db, userId);
  const summary: DeliverySummary = {
    delivered: 0,
    failed: 0,
    removed: 0,
    live: subs.length,
    failures: [],
  };

  for (const sub of subs) {
    const result = await sendPush(sub, payload, env);
    if (result.ok) {
      await recordPushOk(db, sub.id);
      summary.delivered += 1;
    } else if (isGone(result)) {
      await deleteSubscription(db, sub.id);
      summary.removed += 1;
      summary.live -= 1;
      summary.failures.push({ status: result.status, bodyPrefix: result.bodyPrefix ?? null });
    } else {
      summary.failed += 1;
      summary.failures.push({ status: result.status, bodyPrefix: result.bodyPrefix ?? null });
      if (await recordPushFailure(db, sub.id)) {
        summary.removed += 1;
        summary.live -= 1;
      }
    }
  }
  return summary;
}
