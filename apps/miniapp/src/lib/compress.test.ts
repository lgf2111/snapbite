import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compressPhoto } from './compress.js';

/*
 * jsdom has no image decoder or canvas encoder, so the browser pieces are stubbed
 * and these tests pin down what compressPhoto asks of them: that it always draws
 * to a canvas and asks for a fresh JPEG, whatever the input was.
 */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

let requested: string[];
let drawn: number;

beforeEach(() => {
  requested = [];
  drawn = 0;
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 4000, height: 3000, close: () => {} })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: () => {
      drawn += 1;
    },
    imageSmoothingQuality: 'low',
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb, type) => {
    requested.push(String(type));
    cb(new Blob([JPEG_BYTES], { type: String(type) }));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('compressPhoto', () => {
  it.each([
    ['image/heic', 'photo.heic'],
    ['image/png', 'screenshot.png'],
    ['image/jpeg', 'photo.jpg'],
    ['image/webp', 'photo.webp'],
  ])('turns a %s into a fresh JPEG drawn through a canvas', async (type, name) => {
    const original = new File([new Uint8Array([1, 2, 3, 4])], name, { type });
    const out = await compressPhoto(original);

    expect(out.mimeType).toBe('image/jpeg');
    expect(requested.every((t) => t === 'image/jpeg')).toBe(true);
    expect(drawn).toBe(1);
    // What comes back is the canvas's export, not the original bytes.
    const bytes = Uint8Array.from(atob(out.base64), (c) => c.charCodeAt(0));
    expect(Array.from(bytes)).toEqual(Array.from(JPEG_BYTES));
    expect(Array.from(bytes)).not.toEqual([1, 2, 3, 4]);
  });

  it('re-encodes even a small JPEG that is already under the size budget', async () => {
    const tiny = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'tiny.jpg', { type: 'image/jpeg' });
    const out = await compressPhoto(tiny, { maxBytes: 10_000_000 });
    expect(drawn).toBe(1);
    expect(requested).toEqual(['image/jpeg']);
    expect(out.mimeType).toBe('image/jpeg');
  });

  it('downscales a large photo to the long-edge limit', async () => {
    const out = await compressPhoto(new File(['x'], 'big.jpg', { type: 'image/jpeg' }));
    expect(Math.max(out.width, out.height)).toBe(1600);
  });
});
