import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { deviceTokens, users } from './schema.js';

/**
 * Per-device bearer tokens for surfaces that cannot produce Telegram initData
 * (an iOS Shortcut posting a photo, a future PWA session). The raw token is
 * shown once at mint time; only its SHA-256 hash is stored.
 */

export function createDeviceTokensDb(d1: D1Database) {
  return drizzle(d1, { schema: { deviceTokens, users } });
}

export type DeviceTokensDb = ReturnType<typeof createDeviceTokensDb>;

/** `sb_` + 32 random bytes, base64url. Shown to the user exactly once. */
export function mintDeviceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `sb_${b64}`;
}

/** Tokens are looked up by hash, never by value. */
export async function hashDeviceToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createDeviceToken(
  db: DeviceTokensDb,
  input: { userId: string; tokenHash: string; label?: string | null; now?: number },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(deviceTokens).values({
    id,
    userId: input.userId,
    tokenHash: input.tokenHash,
    label: input.label ?? null,
    createdAt: input.now ?? Date.now(),
  });
  return id;
}

export interface ResolvedDeviceToken {
  tokenId: string;
  userId: string;
  /** Null when the account has no Telegram identity yet. */
  telegramUserId: number | null;
}

/** Resolves an un-revoked token hash to its owner, or null. */
export async function resolveDeviceToken(
  db: DeviceTokensDb,
  tokenHash: string,
): Promise<ResolvedDeviceToken | null> {
  const rows = await db
    .select({
      tokenId: deviceTokens.id,
      userId: deviceTokens.userId,
      telegramUserId: users.telegramUserId,
    })
    .from(deviceTokens)
    .innerJoin(users, eq(users.id, deviceTokens.userId))
    .where(and(eq(deviceTokens.tokenHash, tokenHash), isNull(deviceTokens.revokedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** Best-effort "last seen" stamp; never fails the request. */
export async function touchDeviceToken(db: DeviceTokensDb, tokenId: string): Promise<void> {
  try {
    await db
      .update(deviceTokens)
      .set({ lastUsedAt: Date.now() })
      .where(eq(deviceTokens.id, tokenId));
  } catch {
    // ignore
  }
}

/** Revokes every active token for a user and reports how many were live. */
export async function revokeAllDeviceTokens(db: DeviceTokensDb, userId: string): Promise<number> {
  const live = await db
    .select({ id: deviceTokens.id })
    .from(deviceTokens)
    .where(and(eq(deviceTokens.userId, userId), isNull(deviceTokens.revokedAt)));
  if (live.length === 0) return 0;
  await db
    .update(deviceTokens)
    .set({ revokedAt: Date.now() })
    .where(and(eq(deviceTokens.userId, userId), isNull(deviceTokens.revokedAt)));
  return live.length;
}
