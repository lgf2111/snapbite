/**
 * Client-side photo compression.
 *
 * A modern phone photo is 3–6 MB of 12 MP. The analyser does not need that, and
 * R2 should not store it: we downscale to a long edge, re-encode as JPEG and
 * step the quality down until the file fits a byte budget. Deterministic and
 * cheap — the whole thing is one canvas draw plus `toBlob`.
 *
 * It is also what makes an upload carry no metadata. Drawing to a canvas and
 * exporting a fresh JPEG keeps only pixels: EXIF, GPS position, device model and
 * timestamps do not survive it. There is deliberately NO path that skips this and
 * passes the original file through (not for a small file, not for one that is
 * already a JPEG), because that is exactly where the location would leak.
 */

export interface CompressedPhoto {
  /** Base64 WITHOUT the `data:` prefix — what the API expects. */
  base64: string;
  mimeType: 'image/jpeg';
  /** Final size in bytes (post-compression). */
  bytes: number;
  width: number;
  height: number;
}

export interface CompressOptions {
  /** Longest edge, in px. 1600 is plenty for a plate at phone-hold distance. */
  maxEdge?: number;
  /** Upper bound on the encoded size. Quality steps down until it fits. */
  maxBytes?: number;
}

const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.5, 0.42];

function base64FromBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : '');
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the photo'));
    reader.readAsDataURL(blob);
  });
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Decodes, downscales and re-encodes an image file. Throws when the browser
 * cannot decode the file (e.g. HEIC in a browser without a decoder).
 */
export async function compressPhoto(
  file: Blob,
  opts: CompressOptions = {},
): Promise<CompressedPhoto> {
  const maxEdge = opts.maxEdge ?? 1600;
  const maxBytes = opts.maxBytes ?? 400 * 1024;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  let blob: Blob | null = null;
  for (const quality of QUALITY_STEPS) {
    blob = await encode(canvas, quality);
    if (blob.size <= maxBytes) break;
  }
  if (!blob) throw new Error('Could not encode the photo');

  return {
    base64: await base64FromBlob(blob),
    mimeType: 'image/jpeg',
    bytes: blob.size,
    width,
    height,
  };
}

/** Human-readable size, for the upload UI. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
