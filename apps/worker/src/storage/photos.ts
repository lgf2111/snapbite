/**
 * Photo objects in R2 (binding `PHOTOS`).
 *
 * Key layout: `photos/<mealId>` — one object per meal, overwritten on re-log.
 * Meal rows carry `photo_key` (null when no bytes are owned) and `photo_mime`.
 * Telegram `file_id` handling stays as-is; the read path prefers R2 and falls
 * back to the Bot API, so old bot meals keep working and new ones survive the
 * bot going away.
 */

export interface ObjectStore {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; mime: string | null } | null>;
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
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      const bytes = new Uint8Array(await obj.arrayBuffer());
      return { bytes, mime: obj.httpMetadata?.contentType ?? null };
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}
