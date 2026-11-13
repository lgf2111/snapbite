import { ApiError } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportData, exportErrorMessage } from './ExportData.js';
import { Toaster } from './ui/sonner.js';

const DATA = { exportedAt: '2026-11-12T00:00:00Z', meals: [{ id: 'm1', label: 'Chicken rice' }] };
const TEXT = JSON.stringify(DATA, null, 2);

let backend: Backend;
let clicked: Array<{ download: string; href: string }>;
let blobs: Blob[];
let open: ReturnType<typeof vi.fn>;

function stubBackend(exportData: () => Promise<unknown>) {
  backend = {
    mode: 'worker',
    exportData: vi.fn(exportData),
    exportUrl: () => 'https://snapbite.example/api/account/export?initData=',
  } as unknown as Backend;
}

beforeEach(() => {
  clicked = [];
  blobs = [];
  open = vi.fn();
  vi.stubGlobal('open', open);
  // jsdom has no object URLs; record what would have been downloaded.
  URL.createObjectURL = vi.fn((b: Blob) => {
    blobs.push(b);
    return `blob:mock/${blobs.length}`;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ download: this.download, href: this.href });
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  stubBackend(async () => DATA);
});

afterEach(() => {
  cleanup();
  toast.dismiss();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'canShare');
  Reflect.deleteProperty(navigator, 'clipboard');
});

const readBlob = (b: Blob) =>
  new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsText(b);
  });

const press = () => fireEvent.click(screen.getByRole('button', { name: /export my data/i }));

describe('Export my data', () => {
  it('fetches inside the app and downloads a Blob with a dated filename', async () => {
    render(
      <>
        <ExportData backend={backend} />
        <Toaster />
      </>,
    );
    press();

    await waitFor(() => expect(clicked).toHaveLength(1));
    const date = new Date().toISOString().slice(0, 10);
    expect(clicked[0]?.download).toBe(`snapbite-export-${date}.json`);
    expect(clicked[0]?.href).toMatch(/^blob:/);
    expect(await readBlob(blobs[0] as Blob)).toBe(TEXT);
    expect(blobs[0]?.type).toBe('application/json');
    // Never sends the person to a page.
    expect(open).not.toHaveBeenCalled();
    expect(backend.exportData).toHaveBeenCalledTimes(1);
    await screen.findByText('Export ready');
  });

  it('shows progress while the request runs', async () => {
    let finish: (v: unknown) => void = () => {};
    stubBackend(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<ExportData backend={backend} />);
    press();

    const busy = (await screen.findByRole('button', { name: /exporting/i })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    finish(DATA);
    await screen.findByRole('button', { name: /export my data/i });
  });

  it('offers Share when the share sheet accepts files', async () => {
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    render(
      <>
        <ExportData backend={backend} />
        <Toaster />
      </>,
    );
    press();

    fireEvent.click(await screen.findByRole('button', { name: 'Share' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const arg = (share.mock.calls[0] as unknown as [{ files: File[] }])[0];
    expect(arg.files[0]?.name).toMatch(/^snapbite-export-\d{4}-\d{2}-\d{2}\.json$/);
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(401, 'Unauthorized'), 'Sign in again'],
    [new ApiError(500, 'Export failed: database is locked'), 'Export failed: database is locked'],
    [new ApiError(0, 'Request timed out. Please try again.'), 'Request timed out'],
  ])('shows a real error when the fetch fails (%s), and opens nothing', async (err, shown) => {
    stubBackend(async () => {
      throw err;
    });
    render(
      <>
        <ExportData backend={backend} />
        <Toaster />
      </>,
    );
    press();

    expect((await screen.findByText(new RegExp(shown, 'i'))).textContent).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(0);
    // The button is usable again.
    expect(
      (screen.getByRole('button', { name: /export my data/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('when a download is not possible, shows the JSON with Copy and Share', async () => {
    // A browser with no <a download>: the click would do nothing.
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = Document.prototype.createElement.call(document, tag);
      if (tag === 'a') Reflect.deleteProperty(Object.getPrototypeOf(el), 'download');
      return el;
    }) as typeof document.createElement);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(navigator, 'share', { value: vi.fn(async () => {}), configurable: true });

    render(<ExportData backend={backend} />);
    press();

    const sheet = await screen.findByRole('dialog');
    const json = within(sheet).getByTestId('export-json');
    expect(json.textContent).toBe(TEXT);
    expect(json.className).toContain('font-mono');
    expect(json.className).toContain('overflow-auto');
    expect(within(sheet).getByRole('button', { name: 'Share' })).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TEXT));
    await within(sheet).findByRole('button', { name: 'Copied' });
    expect(open).not.toHaveBeenCalled();
  });
});

describe('exportErrorMessage', () => {
  it('says to sign in again on a 401 and passes the server message through otherwise', () => {
    expect(exportErrorMessage(new ApiError(401, 'x'))).toMatch(/sign in again/i);
    expect(exportErrorMessage(new ApiError(500, 'boom'))).toBe('boom');
    expect(exportErrorMessage(new ApiError(503, ''))).toBe(
      'The export failed. Try again in a moment.',
    );
    expect(exportErrorMessage(new Error('offline'))).toBe('offline');
  });
});
