/**
 * Runtime config for the Mini App.
 *
 * - `workerUrl` comes from VITE_WORKER_URL at build time. When empty (the
 *   default in local dev with no backend), the app runs on the mock processor.
 */
export interface AppConfig {
  workerUrl: string;
  /** True when a Worker backend is configured. */
  hasBackend: boolean;
}

export function readConfig(): AppConfig {
  const workerUrl = (import.meta.env.VITE_WORKER_URL ?? '').trim();
  return { workerUrl, hasBackend: workerUrl.length > 0 };
}
