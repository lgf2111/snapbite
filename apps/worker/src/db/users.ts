import type { TelegramUser } from '@foodlog/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { settings, users, type UserRow } from './schema.js';

/** A user + their last-broadcast reference, for the /broadcast command. */
export interface BroadcastTarget {
  id: string;
  telegramUserId: number;
  lastBroadcastChatId: number | null;
  lastBroadcastMessageId: number | null;
  lastBroadcastAt: number | null;
  lastBroadcastVersion: string | null;
}

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
    lastBroadcastChatId: null,
    lastBroadcastMessageId: null,
    lastBroadcastAt: null,
    lastBroadcastVersion: null,
  };
  await db.insert(users).values(row);
  await db
    .insert(settings)
    .values({ userId: row.id, aiProvider: 'gemini', updatedAt: now })
    .onConflictDoNothing();
  return row;
}

/** All users with their last-broadcast reference (for the admin /broadcast). */
export async function listBroadcastTargets(db: Db): Promise<BroadcastTarget[]> {
  return db
    .select({
      id: users.id,
      telegramUserId: users.telegramUserId,
      lastBroadcastChatId: users.lastBroadcastChatId,
      lastBroadcastMessageId: users.lastBroadcastMessageId,
      lastBroadcastAt: users.lastBroadcastAt,
      lastBroadcastVersion: users.lastBroadcastVersion,
    })
    .from(users);
}

/** Records the message we sent/edited for a user's latest broadcast. */
export async function setBroadcastRef(
  db: Db,
  userId: string,
  ref: { chatId: number; messageId: number; version: string; at: number },
): Promise<void> {
  await db
    .update(users)
    .set({
      lastBroadcastChatId: ref.chatId,
      lastBroadcastMessageId: ref.messageId,
      lastBroadcastVersion: ref.version,
      lastBroadcastAt: ref.at,
    })
    .where(eq(users.id, userId));
}
