import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shareOrSaveImage } from './share.js';

/*
 * The OS share sheet only shows a meal thumbnail when it gets a real image file:
 * a name with an extension, a concrete MIME type, and a file `canShare` accepts.
 * jsdom has no share sheet, so these stub the Web Share API and assert exactly
 * what the app hands it — including the download fallback.
 */

const BLOB = new Blob(['jpeg'], { type: 'image/jpeg' });

let share: ReturnType<typeof vi.fn>;
let canShare: ReturnType<typeof vi.fn>;
let downloads: string[];

beforeEach(() => {
  share = vi.fn(async () => {});
  canShare = vi.fn(() => true);
  downloads = [];
  vi.stubGlobal('navigator', { share, canShare });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('shareOrSaveImage', () => {
  it('shares a .jpg file with a concrete image MIME type', async () => {
    const result = await shareOrSaveImage(BLOB, 'snapbite-meal.jpg', 'My meal');

    expect(result).toBe('shared');
    expect(canShare).toHaveBeenCalledTimes(1);
    const file = (canShare.mock.calls[0]?.[0] as ShareData).files?.[0] as File;
    expect(file.name).toBe('snapbite-meal.jpg');
    expect(file.name).toMatch(/\.(png|jpe?g)$/i);
    expect(file.type).toBe('image/jpeg');
    // The exact file confirmed by canShare is the one handed to share.
    expect(share).toHaveBeenCalledWith({ files: [file], text: 'My meal' });
  });

  it('adds the extension when the caller leaves it off, so iOS can preview it', async () => {
    await shareOrSaveImage(BLOB, 'snapbite-meal');

    const file = (canShare.mock.calls[0]?.[0] as ShareData).files?.[0] as File;
    expect(file.name).toBe('snapbite-meal.jpg');
    expect(file.type).toBe('image/jpeg');
  });

  it('falls back to a download without opening the share sheet when canShare is false', async () => {
    canShare.mockReturnValue(false);

    const result = await shareOrSaveImage(BLOB, 'snapbite-meal.jpg');

    expect(result).toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
    // The downloaded file keeps the same identified name.
    expect(downloads).toEqual(['snapbite-meal.jpg']);
  });
});
