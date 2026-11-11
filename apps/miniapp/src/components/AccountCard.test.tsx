import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
