/// <reference types="vite/client" />

/**
 * The id of this build, replaced by Vite at build time (see vite.config.ts).
 * `/version.json` carries the same value for the currently deployed build.
 */
declare const __BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_WORKER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
