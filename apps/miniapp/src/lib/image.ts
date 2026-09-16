import type { MealImage } from '@foodlog/core';

export interface DownscaleOptions {
  /** Longest-edge target in pixels. DeepSeek downscales to 512 anyway. */
  maxEdge?: number;
  /** JPEG quality 0..1. */
  quality?: number;
}

export interface DownscaledImage extends MealImage {
  /** A data URL for previewing the captured photo in the UI. */
  previewUrl: string;
  width: number;
  height: number;
}

/**
 * Downscales a captured image File to a JPEG no larger than `maxEdge` on its
 * longest side, returning base64 (no prefix), a preview data URL, and dims.
 *
 * Runs entirely client-side via a canvas — the raw photo never leaves the
 * device at full resolution. Uses `createImageBitmap` when available and falls
 * back to an <img> element.
 */
export async function downscaleImage(
  file: Blob,
  opts: DownscaleOptions = {},
): Promise<DownscaledImage> {
  const maxEdge = opts.maxEdge ?? 1024;
  const quality = opts.quality ?? 0.8;

  const { bitmap, width, height } = await loadBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, targetW, targetH);
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  const previewUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = previewUrl.slice(previewUrl.indexOf(',') + 1);

  return {
    base64,
    mimeType: 'image/jpeg',
    previewUrl,
    width: targetW,
    height: targetH,
  };
}

interface LoadedBitmap {
  bitmap: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
}

async function loadBitmap(file: Blob): Promise<LoadedBitmap> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to load image'));
      el.src = url;
    });
    return { bitmap: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
