import { desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { feedback, type FeedbackRow } from './schema.js';

export function createFeedbackDb(d1: D1Database) {
  return drizzle(d1, { schema: { feedback } });
}

export type FeedbackDb = ReturnType<typeof createFeedbackDb>;

/** Max stored feedback length (matches the API cap). */
export const FEEDBACK_MAX_LEN = 2000;

export interface FeedbackInput {
  telegramUserId?: number | null;
  source: 'bot' | 'miniapp';
  message: string;
}

/**
 * Stores a feedback entry and returns the created row. Trims + caps the message.
 * Throws only on a genuine DB failure (callers decide how to surface that).
 */
export async function storeFeedback(d1: D1Database, input: FeedbackInput): Promise<FeedbackRow> {
  const db = createFeedbackDb(d1);
  const row: FeedbackRow = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    telegramUserId: input.telegramUserId ?? null,
    source: input.source,
    message: input.message.trim().slice(0, FEEDBACK_MAX_LEN),
    handled: 0,
  };
  await db.insert(feedback).values(row);
  return row;
}

/** Most recent feedback entries, newest first. */
export async function recentFeedback(d1: D1Database, limit = 10): Promise<FeedbackRow[]> {
  try {
    const db = createFeedbackDb(d1);
    return await db.select().from(feedback).orderBy(desc(feedback.createdAt)).limit(limit);
  } catch {
    return [];
  }
}
