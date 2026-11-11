import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
            ? { email: true, google: true }
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

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Email me a sign-in link' })).toBeInTheDocument(),
    );
  });
});

describe('AccountCard when signed in', () => {
  function serve(me: unknown, providers = { email: true, google: true }) {
    vi.stubEnv('VITE_WORKER_URL', 'https://worker.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => Response.json(url.endsWith('/providers') ? providers : me)),
    );
  }
  const signInOffers = () => [
    screen.queryByText('Continue with Google'),
    screen.queryByLabelText('Email address'),
    screen.queryByText('Email me a sign-in link'),
  ];

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
    expect(signInOffers()).toEqual([null, null, null]);
  });

  it('says "email link" for a magic-link session, and plain "Signed in" for an old one', async () => {
    serve({ signedIn: true, via: 'session', method: 'email', email: 'a@b.co', userId: 'u' });
    render(<AccountCard />);
    expect(await screen.findByText('Signed in with an email link')).toBeTruthy();
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
    expect(signInOffers()).toEqual([null, null, null]);
  });

  it('never renders the sign-in buttons when /me fails; it offers a retry instead', async () => {
    vi.stubEnv('VITE_WORKER_URL', 'https://worker.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    render(<AccountCard />);

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(signInOffers()).toEqual([null, null, null]);
  });

  it('says so when the email could not be sent, instead of staying silent', async () => {
    vi.stubEnv('VITE_WORKER_URL', 'https://worker.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { method?: string }) => {
        if (url.endsWith('/providers')) return Response.json({ email: true, google: false });
        if (url.endsWith('/login') && init?.method === 'POST')
          return Response.json({ ok: true, delivered: false });
        return Response.json({
          signedIn: false,
          via: null,
          method: null,
          email: null,
          userId: null,
        });
      }),
    );
    render(<AccountCard />);

    const input = await screen.findByLabelText('Email address');
    fireEvent.change(input, { target: { value: 'a@b.co' } });
    fireEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }));

    expect(await screen.findByText(/could not send the sign-in email/i)).toBeTruthy();
  });
});
