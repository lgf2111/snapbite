import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authNotice, fetchMe, resetAuthStatus, takeAuthStatus } from './account.js';

const ME = {
  signedIn: true,
  via: 'session',
  method: 'google',
  email: 'a@b.co',
  userId: 'u',
} as const;

beforeEach(() => {
  resetAuthStatus();
  window.history.replaceState({ keep: true }, '', '/');
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchMe', () => {
  it('returns the answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(ME)),
    );
    expect(await fetchMe('')).toEqual(ME);
  });

  it('asks the same origin when the base is empty, with credentials', async () => {
    const f = vi.fn(async () => Response.json(ME));
    vi.stubGlobal('fetch', f);
    await fetchMe('');
    expect(f).toHaveBeenCalledWith('/api/auth/me', { credentials: 'include' });
  });

  it('is null on a network error or an error status, never a guess', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    expect(await fetchMe('')).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x', { status: 500 })),
    );
    expect(await fetchMe('')).toBeNull();
  });
});

describe('takeAuthStatus', () => {
  it('reads ?auth once, cleans only that param, keeps the rest and the history state', () => {
    window.history.replaceState({ keep: true }, '', '/day/2026-11-11?auth=ok&x=1#top');
    expect(takeAuthStatus()).toBe('ok');
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/day/2026-11-11?x=1#top',
    );
    expect(window.history.state).toEqual({ keep: true });
    // StrictMode runs effects twice: the second ask gets the same answer.
    expect(takeAuthStatus()).toBe('ok');
  });

  it('is null when there is no ?auth', () => {
    expect(takeAuthStatus()).toBeNull();
  });
});

describe('authNotice', () => {
  it('confirms ok only when the server confirms the session', () => {
    expect(authNotice('ok', ME)).toEqual({ kind: 'success', message: 'Signed in as a@b.co' });
    expect(authNotice('ok', null)?.message).toMatch(/did not keep the session/);
    expect(authNotice('ok', { ...ME, signedIn: false })?.kind).toBe('error');
  });

  it('explains each way a sign-in can fail, and says nothing for no status', () => {
    expect(authNotice(null, null)).toBeNull();
    for (const status of ['expired', 'state', 'unverified', 'conflict', 'error', 'weird']) {
      expect(authNotice(status, null)?.kind).toBe('error');
    }
  });
});
