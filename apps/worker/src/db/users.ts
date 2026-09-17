import type { TelegramUser } from '@foodlog/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { settings, users, type UserRow } from './schema.js';

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema: { users, settings } });
}

export type Db = ReturnType<typeof createDb>;

/**
 * Finds the app user for a Telegram user, creating it (and a default settings
 * row) on first sight. Returns the user row.
 */
export async function upsertUser(db: Db, tgUser: TelegramUser): Promise<UserRow> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.telegramUserId, tgUser.id))
    .limit(1);

  const found = existing[0];
  if (found) return found;

  const now = Date.now();
  const row: UserRow = {
    id: crypto.randomUUID(),
    telegramUserId: tgUser.id,
    createdAt: now,
  };
  await db.insert(users).values(row);
  await db
    .insert(settings)
    .values({ userId: row.id, aiProvider: 'gemini', updatedAt: now })
    .onConflictDoNothing();
  return row;
}
