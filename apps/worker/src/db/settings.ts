import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { settings, type SettingsRow, users } from './schema.js';

export function createSettingsDb(d1: D1Database) {
  return drizzle(d1, { schema: { settings, users } });
}

export type SettingsDb = ReturnType<typeof createSettingsDb>;

export async function getSettings(
  db: SettingsDb,
  userId: string,
): Promise<SettingsRow | undefined> {
  const rows = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1);
  return rows[0];
}

export interface SaveKeyInput {
  userId: string;
  aiProvider: string;
  aiModel: string | null;
  apiKeyCiphertext: string;
  apiKeyIv: string;
}

/** Upserts the encrypted API key + provider + model for a user. */
export async function saveEncryptedKey(db: SettingsDb, input: SaveKeyInput): Promise<void> {
  const now = Date.now();
  await db
    .insert(settings)
    .values({
      userId: input.userId,
      aiProvider: input.aiProvider,
      aiModel: input.aiModel,
      apiKeyCiphertext: input.apiKeyCiphertext,
      apiKeyIv: input.apiKeyIv,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: settings.userId,
      set: {
        aiProvider: input.aiProvider,
        aiModel: input.aiModel,
        apiKeyCiphertext: input.apiKeyCiphertext,
        apiKeyIv: input.apiKeyIv,
        updatedAt: now,
      },
    });
}
