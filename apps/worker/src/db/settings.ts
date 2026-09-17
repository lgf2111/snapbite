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

/**
 * A fallback AI provider used when the primary hits a quota/overload error.
 * The key is stored encrypted (same master key as the primary), inside
 * `preferences_json` so no schema migration is needed. Never returned raw.
 */
export interface FallbackConfig {
  provider: string;
  model: string | null;
  keyCiphertext: string;
  keyIv: string;
  /**
   * Whether the fallback is active. Toggling it off in the UI sets this false
   * but KEEPS the stored key, so the user can re-enable without re-entering it.
   * Treated as enabled when absent (back-compat with earlier saves).
   */
  enabled?: boolean;
  /** Custom OpenAI-compatible base URL (when `provider` is `custom`). */
  baseUrl?: string;
  /** Whether the custom endpoint honors `image_url.detail`. */
  supportsDetail?: boolean;
}

/** Custom primary provider config (when `settings.aiProvider` === 'custom'). */
export interface CustomProviderConfig {
  baseUrl: string;
  supportsDetail?: boolean;
}

/** The parsed shape of the `preferences_json` column. */
export interface Preferences {
  /** Raw profile JSON (validated by the route via the core schema). */
  profile?: unknown;
  fallback?: FallbackConfig;
  /** Custom primary provider (base URL + detail support). */
  customProvider?: CustomProviderConfig;
  updatedAt?: number;
}

/** Parses `preferences_json` into a Preferences object ({} on missing/invalid). */
export function parsePreferences(preferencesJson: string | null | undefined): Preferences {
  if (!preferencesJson) return {};
  try {
    const parsed: unknown = JSON.parse(preferencesJson);
    return parsed && typeof parsed === 'object' ? (parsed as Preferences) : {};
  } catch {
    return {};
  }
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

/**
 * Upserts the user's preferences (profile + goal) as JSON in `preferences_json`.
 * Creates the settings row if it doesn't exist yet (with default provider), so
 * a user can set their goal before adding an API key.
 */
export async function savePreferences(
  db: SettingsDb,
  userId: string,
  preferencesJson: string,
): Promise<void> {
  const now = Date.now();
  await db
    .insert(settings)
    .values({ userId, preferencesJson, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.userId,
      set: { preferencesJson, updatedAt: now },
    });
}
