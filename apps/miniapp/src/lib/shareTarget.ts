/**
 * Receiving a photo shared to SnapBite from Android's share sheet.
 *
 * `public/sw.js` answers the share POST and parks the photo in the Cache API; this reads
 * it back, once. The cache name and key must match the ones in sw.js.
 */
const SHARE_CACHE = 'snapbite-share';
const SHARE_PHOTO_KEY = '/__share__/photo';

/** The worker percent-encodes the name so any Unicode filename can ride in a header. */
function sharedFilename(encoded: string | null): string {
  if (!encoded) return 'shared.jpg';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

/** The shared photo, removed from the handoff as it is read. Null when there is none. */
export async function takeSharedPhoto(): Promise<File | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const cache = await caches.open(SHARE_CACHE);
    const res = await cache.match(SHARE_PHOTO_KEY);
    if (!res) return null;
    const blob = await res.blob();
    // One read: a reload must not log the same photo twice.
    await cache.delete(SHARE_PHOTO_KEY);
    return new File([blob], sharedFilename(res.headers.get('x-filename')), {
      type: blob.type || res.headers.get('content-type') || 'image/jpeg',
    });
  } catch {
    return null;
  }
}
