import { describe, expect, it, vi } from 'vitest';
import { createBackend } from './backend.js';
import { PRODUCTION_ORIGIN, resolveApiConfig } from './config.js';

const WORKERS_DEV = 'https://snapbite-worker.lgf2111.workers.dev';
const PROD = { production: true };
const DEV = { production: false };

describe('a production build', () => {
  it('uses a relative /api on whatever origin serves it, never an absolute URL', () => {
    for (const origin of [
      PRODUCTION_ORIGIN,
      'https://snapbite.pages.dev',
      'https://abc123.snapbite.pages.dev',
      'https://self-hosted.example.org',
    ]) {
      const cfg = resolveApiConfig(undefined, { origin }, PROD);
      expect(cfg).toEqual({ apiBase: '', hasBackend: true });
      expect(`${cfg.apiBase}/api/auth/me`).toBe('/api/auth/me');
      expect(cfg.apiBase).not.toMatch(/^https?:/);
    }
  });

  it('is the HTTP backend, not local mode, with no worker URL (the silent-nothing-stored trap)', () => {
    const cfg = resolveApiConfig(undefined, { origin: PRODUCTION_ORIGIN }, PROD);
    expect(cfg.hasBackend).toBe(true);
    expect(createBackend(cfg).mode).toBe('worker');
  });

  it('on the production origin ignores a worker URL that was baked in anyway', () => {
    const cfg = resolveApiConfig(WORKERS_DEV, { origin: PRODUCTION_ORIGIN }, PROD);
    expect(cfg).toEqual({ apiBase: '', hasBackend: true });
  });

  it("sends the app's calls to a relative URL", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return Response.json({ favorites: [] });
      }),
    );
    try {
      await createBackend(
        resolveApiConfig(undefined, { origin: PRODUCTION_ORIGIN }, PROD),
      ).listFavorites();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^\/api\//);
  });
});

describe('dev and test', () => {
  it('with no worker URL is local mode (mock data), which is what empty means here', () => {
    const cfg = resolveApiConfig(undefined, { origin: 'http://localhost:5173' }, DEV);
    expect(cfg).toEqual({ apiBase: '', hasBackend: false });
    expect(createBackend(cfg).mode).toBe('local');
  });

  it('treats a blank worker URL like none', () => {
    expect(resolveApiConfig('  ', { origin: 'http://localhost:5173' }, DEV).hasBackend).toBe(false);
  });

  it('uses VITE_WORKER_URL as given, so localhost can talk to a deployed or local Worker', () => {
    expect(resolveApiConfig(WORKERS_DEV, { origin: 'http://localhost:5173' }, DEV)).toEqual({
      apiBase: WORKERS_DEV,
      hasBackend: true,
    });
    expect(
      resolveApiConfig('http://localhost:8787/', { origin: 'http://localhost:5173' }, DEV).apiBase,
    ).toBe('http://localhost:8787');
  });

  it('a build:local bundle (production build + explicit URL) on localhost uses that URL', () => {
    expect(resolveApiConfig(WORKERS_DEV, { origin: 'http://localhost:4173' }, PROD).apiBase).toBe(
      WORKERS_DEV,
    );
  });
});
