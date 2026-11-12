import { PhotonImage } from '@cf-wasm/photon';

/**
 * Test photos are generated, not checked in: Photon is already in the Worker,
 * so a 1600 px fixture costs a few milliseconds and no binary in the repo.
 */
export function photoJpeg(
  width: number,
  height: number,
  opts: { noise?: number; quality?: number } = {},
): Uint8Array {
  const noise = opts.noise ?? 0;
  const raw = new Uint8Array(width * height * 4);
  let seed = 123456789;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = ((seed >>> 24) / 255 - 0.5) * noise;
      raw[i] = Math.max(0, Math.min(255, (x / width) * 180 + 40 + n));
      raw[i + 1] = Math.max(0, Math.min(255, (y / height) * 160 + 60 + n));
      raw[i + 2] = Math.max(0, Math.min(255, 120 + Math.sin((x + y) / 30) * 60 + n));
      raw[i + 3] = 255;
    }
  }

  const image = new PhotonImage(raw, width, height);
  try {
    return image.get_bytes_jpeg(opts.quality ?? 90);
  } finally {
    image.free();
  }
}

export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  const image = PhotonImage.new_from_byteslice(bytes);
  try {
    return { width: image.get_width(), height: image.get_height() };
  } finally {
    image.free();
  }
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
