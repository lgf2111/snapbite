import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disablePush, enablePush, pushState, pushSupported, sendTestPush } from './push.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** The message a promise rejects with ('' if it does not reject). */
async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const realMatchMedia = window.matchMedia;

interface World {
  ua: string;
  standalone: boolean;
  /** Does the browser expose the Push API at all? */
  api: boolean;
  permission: NotificationPermission;
  subscription: { endpoint: string; toJSON(): unknown; unsubscribe(): Promise<boolean> } | null;
}

const sub = (endpoint = 'https://web.push.apple.com/abc') => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: 'P', auth: 'A' } }),
  unsubscribe: vi.fn(async () => true),
});

/** Put the page in a given browser situation. */
function setWorld(w: Partial<World> = {}) {
  const world: World = {
    ua: DESKTOP,
    standalone: false,
    api: true,
    permission: 'default',
    subscription: null,
    ...w,
  };
  Object.defineProperty(navigator, 'userAgent', { value: world.ua, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value: world.ua === IPHONE ? 5 : 0,
    configurable: true,
  });
  window.matchMedia = ((q: string) => ({
    matches: world.standalone && q.includes('standalone'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;

  const manager = {
    getSubscription: vi.fn(async () => world.subscription),
    subscribe: vi.fn(async () => {
      world.subscription = sub('https://web.push.apple.com/new');
      return world.subscription;
    }),
  };
  const registration = { pushManager: manager };

  if (world.api) {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: async () => registration, ready: Promise.resolve(registration) },
      configurable: true,
    });
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true });
    Object.defineProperty(window, 'Notification', {
      value: {
        get permission() {
          return world.permission;
        },
        requestPermission: vi.fn(async () => {
          world.permission = 'granted';
          return 'granted' as NotificationPermission;
        }),
      },
      configurable: true,
    });
  } else {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    Reflect.deleteProperty(window, 'PushManager');
    Reflect.deleteProperty(window, 'Notification');
  }
  return { world, manager };
}

beforeEach(() => {
  vi.stubEnv('VITE_WORKER_URL', '');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.matchMedia = realMatchMedia;
  for (const k of ['userAgent', 'maxTouchPoints', 'serviceWorker'])
    Reflect.deleteProperty(navigator, k);
  for (const k of ['PushManager', 'Notification']) Reflect.deleteProperty(window, k);
});

describe('pushState', () => {
  it('iOS Safari in a tab needs the app installed first, even though the API is absent there', async () => {
    setWorld({ ua: IPHONE, standalone: false, api: false });
    expect(await pushState()).toBe('needs-install');
  });

  it('iOS in a tab says needs-install even if the API happens to be present', async () => {
    setWorld({ ua: IPHONE, standalone: false, api: true, permission: 'granted' });
    expect(await pushState()).toBe('needs-install');
  });

  it('iOS standalone, permission not asked yet', async () => {
    setWorld({ ua: IPHONE, standalone: true, permission: 'default' });
    expect(await pushState()).toBe('default');
  });

  it('iOS standalone, permission denied', async () => {
    setWorld({ ua: IPHONE, standalone: true, permission: 'denied' });
    expect(await pushState()).toBe('denied');
  });

  it('allowed but not subscribed on this device', async () => {
    setWorld({ ua: IPHONE, standalone: true, permission: 'granted', subscription: null });
    expect(await pushState()).toBe('granted');
  });

  it('already subscribed', async () => {
    setWorld({ ua: IPHONE, standalone: true, permission: 'granted', subscription: sub() });
    expect(await pushState()).toBe('subscribed');
  });

  it('a browser with no service worker / Push API at all is unsupported', async () => {
    setWorld({ ua: DESKTOP, api: false });
    expect(pushSupported()).toBe(false);
    expect(await pushState()).toBe('unsupported');
  });

  it('desktop with the API behaves like any other supported browser', async () => {
    setWorld({ ua: DESKTOP, permission: 'default' });
    expect(pushSupported()).toBe(true);
    expect(await pushState()).toBe('default');
  });
});

describe('enablePush', () => {
  function server(handlers: Record<string, () => Response>) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        const path = Object.keys(handlers).find((p) => String(url).endsWith(p));
        return path ? (handlers[path] as () => Response)() : new Response('{}', { status: 404 });
      }),
    );
    return calls;
  }

  it('asks permission first, subscribes with the server key, and tells the server', async () => {
    const { world, manager } = setWorld({ ua: IPHONE, standalone: true, permission: 'default' });
    const order: string[] = [];
    (
      window.Notification as unknown as { requestPermission: () => Promise<string> }
    ).requestPermission = vi.fn(async () => {
      order.push('permission');
      world.permission = 'granted';
      return 'granted';
    });
    const calls = server({
      '/api/push/key': () => {
        order.push('key');
        return Response.json({
          key: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
        });
      },
      '/api/push/subscribe': () => {
        order.push('subscribe');
        return Response.json({ ok: true });
      },
    });

    expect(await enablePush()).toBe('subscribed');

    expect(order).toEqual(['permission', 'key', 'subscribe']);
    expect(manager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.anything() }),
    );
    const post = calls.find((c) => c.url.endsWith('/subscribe')) as { init: RequestInit };
    expect(JSON.parse(String(post.init.body))).toMatchObject({
      endpoint: 'https://web.push.apple.com/new',
    });
    expect(post.init.credentials).toBe('include');
  });

  it('reuses the subscription this device already has instead of making another', async () => {
    const { manager } = setWorld({
      ua: IPHONE,
      standalone: true,
      permission: 'granted',
      subscription: sub('https://web.push.apple.com/existing'),
    });
    server({
      '/api/push/key': () =>
        Response.json({
          key: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
        }),
      '/api/push/subscribe': () => Response.json({ ok: true }),
    });
    await enablePush();
    expect(manager.subscribe).not.toHaveBeenCalled();
  });

  it('stops quietly when the person says no, and never talks to the server', async () => {
    setWorld({ ua: IPHONE, standalone: true, permission: 'default' });
    (
      window.Notification as unknown as { requestPermission: () => Promise<string> }
    ).requestPermission = vi.fn(async () => 'denied');
    const calls = server({});
    expect(await enablePush()).toBe('denied');
    expect(calls).toHaveLength(0);
  });

  it('refuses in an iOS tab, with the real reason', async () => {
    setWorld({ ua: IPHONE, standalone: false, api: false });
    expect(await failure(enablePush())).toMatch(/Home Screen/);
  });

  it('says so when the server has no push keys', async () => {
    setWorld({ ua: IPHONE, standalone: true, permission: 'granted' });
    server({ '/api/push/key': () => new Response('{}', { status: 503 }) });
    expect(await failure(enablePush())).toMatch(/not set up/);
  });
});

describe('disablePush', () => {
  it('forgets the device on the server, then unsubscribes the browser', async () => {
    const existing = sub('https://web.push.apple.com/mine');
    setWorld({ ua: IPHONE, standalone: true, permission: 'granted', subscription: existing });
    const f = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', f);

    await disablePush();

    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/push/unsubscribe');
    expect(JSON.parse(String(init.body))).toEqual({ endpoint: 'https://web.push.apple.com/mine' });
    expect(existing.unsubscribe).toHaveBeenCalled();
  });
});

describe('sendTestPush', () => {
  it('reports how many devices got it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ok: true, delivered: 2 })),
    );
    expect(await sendTestPush()).toEqual({ delivered: 2 });
  });

  it('says so when this phone has no subscription', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 409 })),
    );
    expect(await failure(sendTestPush())).toMatch(/not subscribed/);
  });
});
