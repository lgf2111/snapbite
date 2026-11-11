/**
 * Runtime config for the Mini App.
 *
 * - `workerUrl` is the base the client prepends to `/api/...`.
 *   - On the production origin it is that origin itself: the Worker answers
 *     `/api/*` on the app's own domain, so the API is same-origin and the
 *     session cookie is first-party. (Called across sites, iOS Safari drops the
 *     cookie, so a sign-in would "succeed" and be forgotten.)
 *   - Anywhere else it comes from VITE_WORKER_URL at build time, which is how
 *     local dev and self-hosting point at a Worker. Empty means no backend: the
 *     app runs on the mock processor.
 */
export interface AppConfig {
  workerUrl: string;
  /** True when a Worker backend is configured. */
  hasBackend: boolean;
}

/** Where the app is served in production; the Worker is routed under `/api/*` here. */
export const PRODUCTION_ORIGIN = 'https://snapbite.leeguanfeng.com';

/** The production origin always wins over a baked-in env value (the old build set the workers.dev URL). */
export function resolveWorkerUrl(override: string | undefined, here: { origin: string }): string {
  if (here.origin === PRODUCTION_ORIGIN) return here.origin;
  return (override ?? '').trim();
}

export function readConfig(): AppConfig {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const workerUrl = resolveWorkerUrl(import.meta.env.VITE_WORKER_URL, { origin });
  return { workerUrl, hasBackend: workerUrl.length > 0 };
}
