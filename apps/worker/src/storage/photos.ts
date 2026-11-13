/**
 * Photo objects in R2 (binding `PHOTOS`).
 *
 * Key layout: `photos/<mealId>` — one object per meal, overwritten on re-log.
 * Meal rows carry `photo_key` (null when no bytes are owned) and `photo_mime`.
 * Telegram `file_id` handling stays as-is; the read path prefers R2 and falls
 * back to the Bot API, so old bot meals keep working and new ones survive the
 * bot going away.
 */

export interface ObjectMeta {
  mime: string | null;
  /** Strong validator for these bytes, quotes included when the store has one. */
  etag: string | null;
  /** Stored size in bytes. */
  size: number;
}

export interface StoredObject extends ObjectMeta {
  bytes: Uint8Array;
}

export interface ObjectStore {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** Metadata only: the cheap path for a conditional photo request. */
  head(key: string): Promise<ObjectMeta | null>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export function photoKey(mealId: string): string {
  return `photos/${mealId}`;
}

/** R2-backed store. */
export function r2Store(bucket: R2Bucket | undefined): ObjectStore | null {
  if (!bucket) return null;
  return {
    async put(key, bytes, mime) {
      await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
    },
    async head(key) {
      const obj = await bucket.head(key);
      if (!obj) return null;
      return {
        mime: obj.httpMetadata?.contentType ?? null,
        etag: obj.httpEtag || null,
        size: obj.size,
      };
    },
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      const bytes = new Uint8Array(await obj.arrayBuffer());
      return {
        bytes,
        mime: obj.httpMetadata?.contentType ?? null,
        etag: obj.httpEtag || null,
        size: obj.size,
      };
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}
