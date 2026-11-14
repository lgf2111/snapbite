import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountCard } from './AccountCard.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('AccountCard sign-in buttons', () => {
  it('puts a hidden Google mark ahead of the label without changing the accessible name', async () => {
    vi.stubEnv('VITE_WORKER_URL', 'https://worker.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(
          url.endsWith('/providers')
            ? { google: true }
            : { signedIn: false, via: null, email: null, userId: null },
        ),
      ),
    );
    render(<AccountCard />);

    const link = await screen.findByRole('link', { name: 'Continue with Google' });
    const svg = link.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 48 48');
    // The mark keeps its own colours: nothing may tint it.
    expect([...(svg?.querySelectorAll('path') ?? [])].map((p) => p.getAttribute('fill'))).toEqual([
      '#EA4335',
      '#4285F4',
      '#FBBC05',
      '#34A853',
    ]);
    expect(svg?.getAttribute('fill')).toBeNull();
  });
});

describe('AccountCard when signed in', () => {
  function serve(me: unknown, providers = { google: true }) {
    vi.stubEnv('VITE_WORKER_URL', 'https://worker.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => Response.json(url.endsWith('/providers') ? providers : me)),
    );
  }
  const signInOffers = () => [screen.queryByText('Continue with Google')];

  it('shows the email, the method and Sign out, and offers nothing to sign in with', async () => {
    serve({
      signedIn: true,
      via: 'session',
      method: 'google',
      email: 'ada@example.com',
      userId: 'u',
    });
    render(<AccountCard />);

    expect(await screen.findByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText('Signed in with Google')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(signInOffers()).toEqual([null]);
  });

  it('says plain "Signed in" for a historical email session and for an old one', async () => {
    serve({ signedIn: true, via: 'session', method: 'email', email: 'a@b.co', userId: 'u' });
    render(<AccountCard />);
    expect(await screen.findByText('Signed in')).toBeTruthy();
    cleanup();

    serve({ signedIn: true, via: 'session', method: null, email: 'a@b.co', userId: 'u' });
    render(<AccountCard />);
    expect(await screen.findByText('Signed in')).toBeTruthy();
  });

  it('never renders the sign-in buttons while /me is still loading', async () => {
    vi.stubEnv('VITE_WORKER_URL', 'https://worker.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    render(<AccountCard />);

    expect(screen.getByText('Checking your account…')).toBeTruthy();
    expect(signInOffers()).toEqual([null]);
  });

  it('never renders the sign-in buttons when /me fails; it offers a retry instead', async () => {
    vi.stubEnv('VITE_WORKER_URL', 'https://worker.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    render(<AccountCard />);

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(signInOffers()).toEqual([null]);
  });
});
