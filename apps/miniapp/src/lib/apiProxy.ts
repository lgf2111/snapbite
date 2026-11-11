/**
 * The same-origin API proxy, as a plain function so it can be tested.
 *
 * `functions/api/[[path]].ts` (a Cloudflare Pages Function) hands every `/api/*`
 * request on the app's own domain to this, which forwards it to the Worker. The
 * browser then talks to one origin, so the session cookie is first-party and iOS
 * Safari keeps it. No DNS zone permission is involved: the Function runs inside
 * the Pages project that already serves the domain.
 */

/** Where the Worker lives. Overridable with the `API_ORIGIN` variable on the Pages project. */
export const DEFAULT_WORKER_ORIGIN = 'https://snapbite-worker.lgf2111.workers.dev';

export interface ProxyEnv {
  /**
   * Optional service binding to the Worker (Pages project -> Settings -> Functions ->
   * Service bindings, name `API`). Used instead of a public fetch when present;
   * it is the escape hatch if Cloudflare refuses a Function fetching a
   * workers.dev address of the same account (error 1042).
   */
  API?: { fetch(request: Request): Promise<Response> };
  API_ORIGIN?: string;
}

/**
 * Forward `request` to the Worker, keeping method, path, query string, headers
 * and body, and hand the Worker's response straight back.
 *
 *  - The body is passed through as a stream, never read as text: a multipart
 *    photo upload must arrive byte for byte.
 *  - Redirects are not followed: Google's 302 and the sign-in callback's 302
 *    belong to the browser.
 *  - `x-forwarded-host` / `-proto` always carry what the browser used, replacing
 *    anything the client sent, so the Worker can tell which origin it is behind
 *    (it only trusts them when they equal its APP_ORIGIN).
 */
export async function proxyToWorker(request: Request, env: ProxyEnv = {}): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(
    incoming.pathname + incoming.search,
    env.API_ORIGIN ?? DEFAULT_WORKER_ORIGIN,
  );

  const headers = new Headers(request.headers);
  // The Host header names the Worker, not us; the URL decides it.
  headers.delete('host');
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.replace(/:$/, ''));
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstream = new Request(target, {
    method: request.method,
    headers,
    redirect: 'manual',
    ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
  } as RequestInit);

  return env.API ? env.API.fetch(upstream) : fetch(upstream);
}
