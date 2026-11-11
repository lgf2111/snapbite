/**
 * Where the client sends its API calls, and whether there is a backend at all.
 *
 * `apiBase` is prepended to `/api/...`. The empty string means *same origin*:
 * the request goes to whatever origin served the app, where a Pages Function
 * (functions/api/[[path]].ts) forwards it to the Worker. That is what production
 * must use. Called across sites instead, the session cookie is third-party and
 * iOS Safari drops it: a sign-in "succeeds" and is forgotten, and Google's
 * account chooser even names the Worker's host.
 *
 *  - A production build with no `VITE_WORKER_URL` is same-origin. It is NOT local
 *    mode: an empty value only means "no backend" in dev and tests, where there
 *    is no proxy to talk to.
 *  - `VITE_WORKER_URL` stays the way to point dev, or a `build:local` bundle on
 *    localhost, at a Worker (e.g. http://localhost:8787 or a deployed one).
 *  - On the production origin the override is ignored even if one was baked in.
 */
export interface AppConfig {
  /** Prefix for `/api/...`; '' is same-origin. Never an absolute URL in production. */
  apiBase: string;
  /** False only in dev/tests with no Worker configured: the app runs on local storage. */
  hasBackend: boolean;
}

/** Where the app is served in production. */
export const PRODUCTION_ORIGIN = 'https://snapbite.leeguanfeng.com';

export function resolveApiConfig(
  override: string | undefined,
  here: { origin: string },
  build: { production: boolean },
): AppConfig {
  // The one origin that must never talk to the Worker directly.
  if (here.origin === PRODUCTION_ORIGIN) return { apiBase: '', hasBackend: true };

  const explicit = (override ?? '').trim().replace(/\/+$/, '');
  if (explicit) return { apiBase: explicit, hasBackend: true };

  // A production bundle has the Pages Function beside it: same-origin, HTTP backend.
  if (build.production) return { apiBase: '', hasBackend: true };

  // `vite dev` / tests with nothing configured: the mock/local backend.
  return { apiBase: '', hasBackend: false };
}

export function readConfig(): AppConfig {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return resolveApiConfig(
    import.meta.env.VITE_WORKER_URL,
    { origin },
    {
      production: import.meta.env.PROD === true,
    },
  );
}
