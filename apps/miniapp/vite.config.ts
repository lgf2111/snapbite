import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

/**
 * The build's identity, generated once per `vite build`.
 *
 * The git short SHA says which source this is; the random suffix says which
 * deploy it is. Both are needed: the same commit deployed twice must still get a
 * new id, or a browser sitting on the old bundle would never learn that the
 * server has moved. `/version.json` and the bundle's `__BUILD_ID__` share this
 * one value, so the running app can compare them and tell that it is stale.
 *
 * Asset filenames get the same id for the cache-busting reason they always have
 * (see the output config below): an unchanged bundle keeps Vite's content hash,
 * and a fresh URL is what forces the Telegram webview to re-fetch it.
 */
function buildIdentity(): { id: string; builtAt: number } {
  let commit: string | null = null;
  try {
    commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // No git (a tarball build, CI without history): a random id is enough.
  }
  return {
    id: commit ? `${commit}-${randomBytes(3).toString('hex')}` : randomBytes(4).toString('hex'),
    builtAt: Date.now(),
  };
}

const BUILD = buildIdentity();
const BUILD_ID = BUILD.id;

/** Writes the same id the bundle carries to `/version.json` at the site root. */
function versionFile(): Plugin {
  return {
    name: 'snapbite-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify(BUILD),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-${BUILD_ID}-[hash].js`,
        chunkFileNames: `assets/[name]-${BUILD_ID}-[hash].js`,
        assetFileNames: `assets/[name]-${BUILD_ID}-[hash][extname]`,
      },
    },
  },
  server: {
    port: 5173,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
