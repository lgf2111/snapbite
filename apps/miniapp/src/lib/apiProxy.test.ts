import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKER_ORIGIN, proxyToWorker } from './apiProxy.js';

const APP = 'https://snapbite.leeguanfeng.com';

/** What the upstream Worker saw, recorded. */
interface Seen {
  url: string;
  method: string;
  headers: Headers;
  redirect: string;
  body: Uint8Array;
}

function upstream(reply: () => Response = () => new Response('ok')) {
  const seen: Seen[] = [];
  const fetchFn = vi.fn(async (req: Request) => {
    seen.push({
      url: req.url,
      method: req.method,
      headers: req.headers,
      redirect: req.redirect,
      body: new Uint8Array(await req.arrayBuffer()),
    });
    return reply();
  });
  return { seen, fetchFn };
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

afterEach(() => vi.unstubAllGlobals());

describe('proxyToWorker', () => {
  it('keeps method, path and query string, and sends them to the Worker', async () => {
    const { seen, fetchFn } = upstream();
    vi.stubGlobal('fetch', fetchFn);

    await proxyToWorker(new Request(`${APP}/api/meals?date=2026-11-11&tz=-480`), {});

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`${DEFAULT_WORKER_ORIGIN}/api/meals?date=2026-11-11&tz=-480`);
    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.body.byteLength).toBe(0);
  });

  it('keeps the headers the Worker needs (token, cookie, content type)', async () => {
    const { seen, fetchFn } = upstream();
    vi.stubGlobal('fetch', fetchFn);

    await proxyToWorker(
      new Request(`${APP}/api/shortcut/ping`, {
        headers: {
          authorization: 'Bearer sb_abc',
          cookie: 'sb_session=xyz',
          'x-telegram-init-data': 'query_id=1',
        },
      }),
      {},
    );

    const h = seen[0]?.headers as Headers;
    expect(h.get('authorization')).toBe('Bearer sb_abc');
    expect(h.get('cookie')).toBe('sb_session=xyz');
    expect(h.get('x-telegram-init-data')).toBe('query_id=1');
  });

  it('tells the Worker which origin the browser used, over anything the client sent', async () => {
    const { seen, fetchFn } = upstream();
    vi.stubGlobal('fetch', fetchFn);

    await proxyToWorker(
      new Request(`${APP}/api/auth/start/google`, {
        headers: { 'x-forwarded-host': 'evil.example.com', 'x-forwarded-proto': 'http' },
      }),
      {},
    );

    const h = seen[0]?.headers as Headers;
    expect(h.get('x-forwarded-host')).toBe('snapbite.leeguanfeng.com');
    expect(h.get('x-forwarded-proto')).toBe('https');
  });

  it('passes a multipart upload through byte for byte', async () => {
    const { seen, fetchFn } = upstream();
    vi.stubGlobal('fetch', fetchFn);

    // A body that a text codec would wreck: NULs, high bytes, invalid UTF-8,
    // CRLFs, and a JPEG header.
    const boundary = '----sbBoundary7MA4YWxkTrZu0gW';
    const jpeg = new Uint8Array(4096);
    for (let i = 0; i < jpeg.length; i++) jpeg[i] = (i * 31 + 7) % 256;
    jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00], 0);
    const enc = new TextEncoder();
    const parts = [
      enc.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="m.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      jpeg,
      enc.encode(`\r\n--${boundary}--\r\n`),
    ];
    const body = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
    let at = 0;
    for (const p of parts) {
      body.set(p, at);
      at += p.byteLength;
    }

    await proxyToWorker(
      new Request(`${APP}/api/shortcut/log`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer sb_token',
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      }),
      {},
    );

    const got = seen[0] as Seen;
    expect(got.method).toBe('POST');
    expect(got.body.byteLength).toBe(body.byteLength);
    expect(sha(got.body)).toBe(sha(body));
    // The boundary in the header must still describe the body.
    expect(got.headers.get('content-type')).toBe(`multipart/form-data; boundary=${boundary}`);
  });

  it('does not follow redirects: the 302 belongs to the browser', async () => {
    const { seen, fetchFn } = upstream(
      () =>
        new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/x' } }),
    );
    vi.stubGlobal('fetch', fetchFn);

    const res = await proxyToWorker(new Request(`${APP}/api/auth/start/google`), {});

    expect(seen[0]?.redirect).toBe('manual');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://accounts.google.com/x');
  });

  it("returns the Worker's response untouched: status, body and Set-Cookie", async () => {
    const { fetchFn } = upstream(
      () =>
        new Response('{"detail":"No AI key"}', {
          status: 400,
          headers: {
            'content-type': 'application/json',
            'set-cookie': 'sb_session=abc; Path=/; SameSite=None; Secure; HttpOnly',
          },
        }),
    );
    vi.stubGlobal('fetch', fetchFn);

    const res = await proxyToWorker(
      new Request(`${APP}/api/shortcut/log`, { method: 'POST', body: 'x' }),
      {},
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toBe('{"detail":"No AI key"}');
    // No Domain attribute: the browser files it under the app's own origin.
    expect(res.headers.get('set-cookie')).toBe(
      'sb_session=abc; Path=/; SameSite=None; Secure; HttpOnly',
    );
  });

  it('uses a service binding instead of a public fetch when one is bound', async () => {
    const publicFetch = vi.fn(async () => new Response('public'));
    vi.stubGlobal('fetch', publicFetch);
    const { seen, fetchFn } = upstream(() => new Response('via binding'));

    const res = await proxyToWorker(new Request(`${APP}/api/me`), { API: { fetch: fetchFn } });

    expect(await res.text()).toBe('via binding');
    expect(seen[0]?.url).toBe(`${DEFAULT_WORKER_ORIGIN}/api/me`);
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it('can be pointed at another Worker with API_ORIGIN', async () => {
    const { seen, fetchFn } = upstream();
    vi.stubGlobal('fetch', fetchFn);

    await proxyToWorker(new Request(`${APP}/api/health`), { API_ORIGIN: 'http://localhost:8787' });

    expect(seen[0]?.url).toBe('http://localhost:8787/api/health');
  });

  it('sends no body on GET or HEAD', async () => {
    const { seen, fetchFn } = upstream();
    vi.stubGlobal('fetch', fetchFn);

    await proxyToWorker(new Request(`${APP}/api/me`, { method: 'HEAD' }), {});

    expect(seen[0]?.method).toBe('HEAD');
    expect(seen[0]?.body.byteLength).toBe(0);
  });
});
