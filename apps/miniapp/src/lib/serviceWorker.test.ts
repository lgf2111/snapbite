import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * Runs the real public/sw.js against a stand-in for the worker global scope and
 * fires the events the browser would, so a typo in the hand-written file fails
 * here and not on a phone.
 */
const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

type Handler = (event: Record<string, unknown>) => void;

function load(
  opts: { windows?: Array<{ focus: () => Promise<unknown> }>; oldKey?: Uint8Array } = {},
) {
  const handlers = new Map<string, Handler>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const waits: Array<Promise<unknown>> = [];
  const openWindow = vi.fn(async () => ({}));
  const subscribe = vi.fn(async () => ({
    toJSON: () => ({ endpoint: 'https://web.push.apple.com/new' }),
  }));
  const fetchMock = vi.fn(async (url: string) =>
    String(url).endsWith('/key')
      ? Response.json({
          key: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
        })
      : Response.json({ ok: true }),
  );

  const scope = {
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => opts.windows ?? []),
      openWindow,
    },
    registration: {
      showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      }),
      pushManager: { subscribe },
    },
    location: { origin: 'https://snapbite.leeguanfeng.com' },
  };
  // A Map-backed stand-in for the Cache API, so what the worker stores can be read back.
  const store = new Map<string, Response>();
  const cacheApi = {
    open: vi.fn(async () => ({
      put: vi.fn(async (key: string, res: Response) => {
        store.set(key, res);
      }),
      match: vi.fn(async (key: string) => store.get(key)),
      delete: vi.fn(async (key: string) => store.delete(key)),
    })),
  };
  new Function('self', 'fetch', 'atob', 'URL', 'caches', source)(
    scope,
    fetchMock,
    atob,
    URL,
    cacheApi,
  );

  const fire = async (type: string, event: Record<string, unknown>) => {
    const full = { ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) };
    (handlers.get(type) as Handler)(full);
    await Promise.all(waits.splice(0));
  };
  return { scope, fire, shown, openWindow, subscribe, fetchMock, handlers, store, cacheApi };
}

const pushEvent = (payload: unknown) => ({
  data: { json: () => payload, text: () => JSON.stringify(payload) },
});

describe('public/sw.js', () => {
  it('registers every handler it needs, and takes over at once', async () => {
    const { handlers, scope, fire } = load();
    expect([...handlers.keys()].sort()).toEqual(
      [
        'activate',
        'fetch',
        'install',
        'notificationclick',
        'push',
        'pushsubscriptionchange',
      ].sort(),
    );
    await fire('install', {});
    expect(scope.skipWaiting).toHaveBeenCalled();
    await fire('activate', {});
    expect(scope.clients.claim).toHaveBeenCalled();
  });

  it('shows the notification the push describes', async () => {
    const { fire, shown } = load();
    await fire(
      'push',
      pushEvent({
        title: 'SnapBite',
        body: 'Time to log lunch.',
        url: '/day',
        tag: 'reminder-lunch',
      }),
    );

    expect(shown).toHaveLength(1);
    expect(shown[0]?.title).toBe('SnapBite');
    expect(shown[0]?.options).toMatchObject({
      body: 'Time to log lunch.',
      tag: 'reminder-lunch',
      data: { url: '/day' },
    });
  });

  it('always shows something, even for an empty or non-JSON push (iOS revokes a silent subscriber)', async () => {
    const { fire, shown } = load();
    await fire('push', { data: null });
    await fire('push', {
      data: {
        json: () => {
          throw new SyntaxError('not json');
        },
        text: () => 'plain words',
      },
    });
    expect(shown).toHaveLength(2);
    expect(shown[0]?.title).toBe('SnapBite');
    expect(shown[1]?.options.body).toBe('plain words');
  });

  it('focuses a window that is already open when the notification is tapped', async () => {
    const focus = vi.fn(async () => ({}));
    const { fire, openWindow } = load({ windows: [{ focus }] });
    const close = vi.fn();
    await fire('notificationclick', { notification: { close, data: { url: '/' } } });

    expect(close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('opens the app when no window is open', async () => {
    const { fire, openWindow } = load({ windows: [] });
    await fire('notificationclick', { notification: { close: vi.fn(), data: { url: '/' } } });
    expect(openWindow).toHaveBeenCalledWith('https://snapbite.leeguanfeng.com/');
  });

  it('re-subscribes when the browser rotates the subscription, and tells the server', async () => {
    const { fire, subscribe, fetchMock } = load();
    await fire('pushsubscriptionchange', { oldSubscription: null });

    // Looked the public key up, subscribed with it, and posted the new subscription.
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      '/api/push/key',
      '/api/push/subscribe',
    ]);
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      }),
    );
    const post = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(post[1].method).toBe('POST');
    expect(JSON.parse(String(post[1].body))).toEqual({
      endpoint: 'https://web.push.apple.com/new',
    });
  });

  it('reuses the old subscription’s key when it has one', async () => {
    const key = new Uint8Array([1, 2, 3]);
    const { fire, subscribe, fetchMock } = load();
    await fire('pushsubscriptionchange', {
      oldSubscription: { options: { applicationServerKey: key } },
    });
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ applicationServerKey: key }));
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(['/api/push/subscribe']);
  });
});

describe('public/sw.js: the share target', () => {
  const origin = 'https://snapbite.leeguanfeng.com';

  /** Fires a fetch event and returns what the worker answered with (or null if it let it through). */
  async function share(
    harness: ReturnType<typeof load>,
    init: { method?: string; path?: string; body?: FormData },
  ) {
    // jsdom's FormData and Node's Request do not agree on multipart encoding, so
    // hand the worker the same shape the browser gives it without going through
    // Request: a POST whose formData() returns the form.
    const request = {
      method: init.method ?? 'POST',
      url: `${origin}${init.path ?? '/share-target'}`,
      formData: async () => init.body ?? new FormData(),
    };
    let answer: Promise<Response> | null = null;
    (harness.handlers.get('fetch') as Handler)({
      request,
      respondWith: (p: Promise<Response>) => {
        answer = p;
      },
    });
    return answer ? await (answer as Promise<Response>) : null;
  }

  it('stores the shared photo and redirects to /?shared=1', async () => {
    const harness = load();
    const form = new FormData();
    form.set(
      'photo',
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'lunch.jpg', { type: 'image/jpeg' }),
    );
    form.set('text', 'my lunch');

    const res = await share(harness, { body: form });

    expect(res?.status).toBe(303);
    expect(res?.headers.get('location')).toBe(`${origin}/?shared=1`);
    const stored = harness.store.get('/__share__/photo') as Response;
    expect(stored.headers.get('content-type')).toBe('image/jpeg');
    expect(stored.headers.get('x-filename')).toBe('lunch.jpg');
    expect(Array.from(new Uint8Array(await stored.arrayBuffer()))).toEqual([
      0xff, 0xd8, 0xff, 0xe0,
    ]);
  });

  it('redirects a text-only share too, storing nothing, so the app can say there was no photo', async () => {
    const harness = load();
    const form = new FormData();
    form.set('text', 'just a link');
    const res = await share(harness, { body: form });
    expect(res?.status).toBe(303);
    expect(harness.store.size).toBe(0);
  });

  it('leaves every other request alone', async () => {
    const harness = load();
    expect(await share(harness, { method: 'GET', path: '/share-target' })).toBeNull();
    expect(
      await share(harness, { method: 'POST', path: '/api/meals', body: new FormData() }),
    ).toBeNull();
  });
});
