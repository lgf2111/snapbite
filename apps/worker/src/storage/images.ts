import { PhotonImage, SamplingFilter, resize } from '@cf-wasm/photon';

/**
 * Photo bytes, on the Worker.
 *
 * The Workers runtime has no `OffscreenCanvas` / `createImageBitmap` (they are
 * browser APIs, not part of the Worker global scope), so downscaling goes through
 * Photon: a Rust image library compiled to WASM. It is the one dependency that
 * makes upload shrink and thumbnails real instead of best-effort no-ops.
 */

/** Longest edge for a stored photo: plenty for a plate at phone-hold distance. */
const MAX_EDGE = 1600;
/** Upper bound on a stored photo. Quality steps down until the result fits. */
const MAX_BYTES = 400 * 1024;
/** Photon's JPEG quality is 0–100, not 0–1. */
const QUALITY_STEPS = [82, 70, 60, 50, 42];
/** A thumbnail is already small; one re-encode is enough. */
const THUMB_QUALITY = 78;
/** Formats Photon can decode. GIF is served unchanged (animations must survive). */
const SHRINKABLE = /^image\/(jpeg|png|webp)$/;

export interface CompressedImage {
  base64: string;
  mimeType: string;
  bytes: number;
}

export interface ResizedImage {
  bytes: Uint8Array;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

export function base64FromBytes(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  // Chunked so a large photo doesn't blow the argument limit of fromCharCode.
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Downscale + re-encode a photo before it is stored.
 *
 * Anything already under the byte budget is returned untouched, as is a format
 * the decoder may not handle. Any failure falls back to the original bytes —
 * storage must never lose a meal because a photo was unusual.
 */
export async function shrinkImage(base64: string, mimeType: string): Promise<CompressedImage> {
  const original: CompressedImage = { base64, mimeType, bytes: base64Bytes(base64) };
  if (original.bytes <= MAX_BYTES || !SHRINKABLE.test(mimeType)) return original;

  try {
    const source = base64ToBytes(base64);
    const image = PhotonImage.new_from_byteslice(source);
    try {
      const startWidth = image.get_width();
      const startHeight = image.get_height();
      const scale = Math.min(1, MAX_EDGE / Math.max(startWidth, startHeight));
      const width = Math.max(1, Math.round(startWidth * scale));
      const height = Math.max(1, Math.round(startHeight * scale));
      const target = scale < 1 ? resize(image, width, height, SamplingFilter.Lanczos3) : image;

      try {
        let encoded: Uint8Array | null = null;
        for (const quality of QUALITY_STEPS) {
          encoded = target.get_bytes_jpeg(quality);
          if (encoded.length <= MAX_BYTES) break;
        }
        if (!encoded || encoded.length >= original.bytes) return original;

        // Photon re-encodes pixels only. Keep the EXIF (orientation!) and ICC
        // profile segments of a JPEG, or a portrait photo turns sideways and a
        // Display-P3 photo goes dull.
        const bytes = mimeType === 'image/jpeg' ? attachJpegMetadata(encoded, source) : encoded;
        if (bytes.length >= original.bytes) return original;
        return {
          base64: base64FromBytes(bytes),
          mimeType: 'image/jpeg',
          bytes: bytes.length,
        };
      } finally {
        if (target !== image) target.free();
      }
    } finally {
      image.free();
    }
  } catch {
    return original;
  }
}

/**
 * Re-encode a photo as a JPEG whose longest edge is at most `maxEdge` px.
 *
 * `null` means "serve the original": an undecodable or animated format. The
 * caller must not silently replace the original with a smaller image outside
 * this function.
 */
export function resizeImage(
  bytes: Uint8Array,
  mimeType: string,
  maxEdge: number,
): ResizedImage | null {
  if (!SHRINKABLE.test(mimeType) || !Number.isFinite(maxEdge) || maxEdge < 1) return null;
  try {
    const image = PhotonImage.new_from_byteslice(bytes);
    try {
      const startWidth = image.get_width();
      const startHeight = image.get_height();
      const scale = Math.min(1, maxEdge / Math.max(startWidth, startHeight));
      const width = Math.max(1, Math.round(startWidth * scale));
      const height = Math.max(1, Math.round(startHeight * scale));
      const target = scale < 1 ? resize(image, width, height, SamplingFilter.Lanczos3) : image;

      try {
        const encoded = target.get_bytes_jpeg(THUMB_QUALITY);
        const out = mimeType === 'image/jpeg' ? attachJpegMetadata(encoded, bytes) : encoded;
        return {
          bytes: out,
          mimeType: 'image/jpeg',
          width: target.get_width(),
          height: target.get_height(),
        };
      } finally {
        if (target !== image) target.free();
      }
    } finally {
      image.free();
    }
  } catch {
    return null;
  }
}

/** The EXIF and ICC segments of a JPEG, copied onto a re-encoded image. */
function attachJpegMetadata(encoded: Uint8Array, source: Uint8Array): Uint8Array {
  if (encoded.length < 2 || encoded[0] !== 0xff || encoded[1] !== 0xd8) return encoded;
  const segments = jpegMetadataSegments(source);
  if (segments.length === 0) return encoded;

  const extra = segments.reduce((n, segment) => n + segment.length, 0);
  const out = new Uint8Array(encoded.length + extra);
  out.set(encoded.subarray(0, 2), 0);
  let offset = 2;
  for (const segment of segments) {
    out.set(segment, offset);
    offset += segment.length;
  }
  out.set(encoded.subarray(2), offset);
  return out;
}

/**
 * Walks the JPEG marker segments before the scan data and returns the Exif
 * (APP1) and ICC (APP2) ones. A malformed file simply yields none.
 */
function jpegMetadataSegments(source: Uint8Array): Uint8Array[] {
  const segments: Uint8Array[] = [];
  let i = 2;
  while (i + 4 <= source.length && source[i] === 0xff) {
    const marker = source[i + 1] as number;
    // Start of scan / end of image: metadata has been passed.
    if (marker === 0xda || marker === 0xd9) break;
    const length = ((source[i + 2] as number) << 8) | (source[i + 3] as number);
    if (length < 2 || i + 2 + length > source.length) break;
    const isExif = marker === 0xe1 && asciiAt(source, i + 4, 6) === 'Exif\0\0';
    const isIcc = marker === 0xe2 && asciiAt(source, i + 4, 11) === 'ICC_PROFILE';
    if (isExif || isIcc) segments.push(source.slice(i, i + 2 + length));
    i += 2 + length;
  }
  return segments;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.length) return '';
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
