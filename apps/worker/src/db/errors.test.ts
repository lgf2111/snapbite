import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  createErrorsDb,
  describeError,
  logError,
  pruneErrorsOlderThan,
  recentErrors,
} from './errors.js';
import { errorLogs } from './schema.js';

describe('logError / recentErrors', () => {
  it('persists an error and reads it back newest-first', async () => {
    await logError(env.DB, {
      telegramUserId: 555,
      source: 'analyze',
      kind: 'http',
      status: 502,
      message: 'provider blew up',
      detail: 'stack line 1',
    });
    const rows = await recentErrors(env.DB, 10);
    const found = rows.find((r) => r.telegramUserId === 555 && r.message === 'provider blew up');
    expect(found).toBeTruthy();
    expect(found?.source).toBe('analyze');
    expect(found?.status).toBe(502);
    expect(found?.detail).toBe('stack line 1');
  });

  it('never throws even if the event is odd (best-effort)', async () => {
    // Empty message + no optional fields must still be safe.
    await expect(logError(env.DB, { source: 'webhook', message: '' })).resolves.toBeUndefined();
  });

  it('caps long message + detail to keep rows small', async () => {
    const long = 'x'.repeat(5000);
    await logError(env.DB, { source: 'api', message: long, detail: long });
    const rows = await recentErrors(env.DB, 5);
    const found = rows.find((r) => r.source === 'api' && r.message.startsWith('x'));
    expect(found?.message.length).toBeLessThanOrEqual(2000);
    expect((found?.detail ?? '').length).toBeLessThanOrEqual(2000);
  });
});

describe('pruneErrorsOlderThan', () => {
  it('deletes rows older than the cutoff and keeps newer ones', async () => {
    const db = createErrorsDb(env.DB);
    const now = Date.now();
    const old = now - 40 * 24 * 60 * 60 * 1000; // 40 days ago
    await db.insert(errorLogs).values([
      {
        id: crypto.randomUUID(),
        createdAt: old,
        source: 'prunetest',
        kind: 'old',
        message: 'ancient',
      },
      {
        id: crypto.randomUUID(),
        createdAt: now,
        source: 'prunetest',
        kind: 'new',
        message: 'fresh',
      },
    ]);

    const cutoff = now - 30 * 24 * 60 * 60 * 1000; // 30-day retention
    const removed = await pruneErrorsOlderThan(env.DB, cutoff);
    expect(removed).toBeGreaterThanOrEqual(1);

    const rows = await recentErrors(env.DB, 100);
    const mine = rows.filter((r) => r.source === 'prunetest');
    expect(mine.some((r) => r.message === 'ancient')).toBe(false);
    expect(mine.some((r) => r.message === 'fresh')).toBe(true);
  });

  it('never throws (best-effort)', async () => {
    await expect(pruneErrorsOlderThan(env.DB, Date.now())).resolves.toBeTypeOf('number');
  });
});

describe('describeError', () => {
  it('extracts message/kind/status from an AIProviderError-like object', () => {
    const d = describeError(Object.assign(new Error('boom'), { kind: 'http', status: 429 }));
    expect(d.message).toBe('boom');
    expect(d.kind).toBe('http');
    expect(d.status).toBe(429);
  });

  it('stringifies a non-object throw', () => {
    expect(describeError('nope').message).toBe('nope');
  });
});
