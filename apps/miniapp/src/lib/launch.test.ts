import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetLaunchIntent, takeLaunchIntent } from './launch.js';

const photoKey = '/__share__/photo';

/** A Cache API stand-in holding one shared photo, like the worker's handoff. */
function stubShareCache(response?: Response) {
  const store = new Map<string, Response>();
  if (response) store.set(photoKey, response);
  const cache = {
    match: vi.fn(async (key: string) => store.get(key)),
    delete: vi.fn(async (key: string) => store.delete(key)),
    put: vi.fn(async (key: string, value: Response) => {
      store.set(key, value);
    }),
  };
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
  return { store, cache };
}

const go = (url: string) => window.history.replaceState({}, '', url);

afterEach(() => {
  resetLaunchIntent();
  vi.unstubAllGlobals();
  go('/');
});

describe('takeLaunchIntent', () => {
  it('turns ?capture=camera into the highlighted Take photo card, and strips it', () => {
    go('/?capture=camera');
    expect(takeLaunchIntent()).toEqual({ type: 'menu', highlight: 'photo' });
    expect(window.location.search).toBe('');
  });

  it('maps ?capture=library and ?capture=manual to their surfaces', () => {
    go('/?capture=library');
    expect(takeLaunchIntent()).toEqual({ type: 'menu', highlight: 'upload' });

    resetLaunchIntent();
    go('/?capture=manual');
    expect(takeLaunchIntent()).toEqual({ type: 'manual' });
  });

  it('removes only the launch parameters, keeping an unrelated one and the hash', () => {
    go('/?capture=camera&keep=1#day');
    takeLaunchIntent();
    expect(window.location.search).toBe('?keep=1');
    expect(window.location.hash).toBe('#day');
  });

  it('is null on a normal boot, and reads the URL once (StrictMode double-effect)', () => {
    go('/');
    expect(takeLaunchIntent()).toBeNull();
    // A later navigation in the same page must not look like a launch.
    go('/?capture=camera');
    expect(takeLaunchIntent()).toBeNull();
  });

  it('hands over a shared photo once, then leaves the handoff empty', async () => {
    const { store } = stubShareCache(
      new Response(new TextEncoder().encode('jpeg-bytes'), {
        headers: { 'content-type': 'image/jpeg', 'x-filename': 'lunch.jpg' },
      }),
    );
    go('/?shared=1');

    const intent = takeLaunchIntent();
    expect(intent?.type).toBe('shared');
    if (intent?.type !== 'shared') throw new Error('expected a shared intent');
    const file = await intent.photo;
    expect(file?.name).toBe('lunch.jpg');
    expect(file?.type).toBe('image/jpeg');
    // jsdom's File stringifies a Blob created by the Response polyfill, so both
    // .text() and .size reflect "[object Blob]" here while a browser returns the
    // bytes. Assert the handoff produced a non-empty File of the right type;
    // payload integrity is the service worker's own test.
    expect(file?.size ?? 0).toBeGreaterThan(0);
    expect(store.size).toBe(0);
    expect(window.location.search).toBe('');
  });

  it('decodes a Unicode filename the worker percent-encoded', async () => {
    stubShareCache(
      new Response(new TextEncoder().encode('x'), {
        headers: { 'content-type': 'image/png', 'x-filename': encodeURIComponent('午餐.png') },
      }),
    );
    go('/?shared=1');
    const intent = takeLaunchIntent();
    if (intent?.type !== 'shared') throw new Error('expected a shared intent');
    expect((await intent.photo)?.name).toBe('午餐.png');
  });

  it('reports a text-only share as no photo, not as an error', async () => {
    stubShareCache();
    go('/?shared=1');
    const intent = takeLaunchIntent();
    if (intent?.type !== 'shared') throw new Error('expected a shared intent');
    expect(await intent.photo).toBeNull();
  });
});
