import { describe, expect, it } from 'vitest';
import { PRODUCTION_ORIGIN, resolveWorkerUrl } from './config.js';

const WORKERS_DEV = 'https://snapbite-worker.lgf2111.workers.dev';

describe('resolveWorkerUrl', () => {
  it('is same-origin on the production origin, so /api/* is first-party', () => {
    const base = resolveWorkerUrl(undefined, { origin: PRODUCTION_ORIGIN });
    expect(base).toBe(PRODUCTION_ORIGIN);
    expect(`${base}/api/auth/me`).toBe('https://snapbite.leeguanfeng.com/api/auth/me');
  });

  it('prefers same-origin over a workers.dev URL baked into the build', () => {
    expect(resolveWorkerUrl(WORKERS_DEV, { origin: PRODUCTION_ORIGIN })).toBe(PRODUCTION_ORIGIN);
  });

  it('uses the env override under localhost', () => {
    expect(resolveWorkerUrl(WORKERS_DEV, { origin: 'http://localhost:5173' })).toBe(WORKERS_DEV);
    expect(resolveWorkerUrl(' http://localhost:8787 ', { origin: 'http://localhost:5173' })).toBe(
      'http://localhost:8787',
    );
  });

  it('is empty (mock mode) with no override off the production origin', () => {
    expect(resolveWorkerUrl(undefined, { origin: 'http://localhost:5173' })).toBe('');
    expect(resolveWorkerUrl('', { origin: 'https://preview.pages.dev' })).toBe('');
  });
});
