import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSettings = vi.hoisted(() => vi.fn());
vi.mock('./lib/backend.js', async (orig) => ({
  ...(await orig<typeof import('./lib/backend.js')>()),
  createBackend: () => ({
    mode: 'local',
    getSettings,
    mealsByDate: async () => [],
    mealsInRange: async () => [],
    mealDates: async () => ({ dates: [], streak: 0 }),
  }),
}));

import { App } from './App.js';
import { clearCache } from './lib/cache.js';

describe('first-run onboarding', () => {
  // Test files share one DOM (single fork): leave nothing mounted behind.
  afterEach(cleanup);

  beforeEach(() => {
    cleanup();
    clearCache();
    localStorage.clear();
    getSettings.mockReset();
  });

  it('opens the setup sheet for a brand-new visitor', async () => {
    getSettings.mockResolvedValue({ profile: null, targets: null, connected: false });
    render(<App />);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });

  it('covers the whole screen: no card, no backdrop, Home unreachable behind it', async () => {
    getSettings.mockResolvedValue({ profile: null, targets: null, connected: false });
    render(<App />);
    const layer = await screen.findByRole('dialog');

    expect(layer.className).toContain('fixed inset-0');
    expect(layer.className).not.toMatch(/rounded|max-w-/);
    expect(layer.getAttribute('aria-modal')).toBe('true');
    // The app behind is inert: not focusable, not clickable, not announced.
    expect(document.querySelector('[inert]')?.contains(layer)).toBe(false);
    expect(document.querySelector('[inert]')?.querySelector('nav')).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('keeps the install tip off Home while setup is open, and shows it after', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1',
      configurable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
    try {
      getSettings.mockResolvedValue({ profile: null, targets: null, connected: false });
      render(<App />);
      await screen.findByRole('dialog');
      expect(screen.queryByTestId('install-guide')).toBeNull();

      // Skip setup: Home is visible, so the tip may now render.
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await waitFor(() => expect(screen.getByTestId('install-guide')).toBeTruthy());
    } finally {
      Reflect.deleteProperty(navigator, 'userAgent');
      Reflect.deleteProperty(navigator, 'maxTouchPoints');
    }
  });

  it('shows the welcome on every launch for an account with nothing, even after a skip', async () => {
    // The old gate read this flag and never showed the welcome again.
    localStorage.setItem('snapbite.onboarding.keyDecision', 'skipped');
    getSettings.mockResolvedValue({ profile: null, targets: null, connected: false });

    const first = render(<App />);
    await screen.findByRole('dialog');
    first.unmount();
    clearCache();

    render(<App />);
    await screen.findByRole('dialog');
  });

  it('a skip hides setup for this session and writes nothing that survives it', async () => {
    getSettings.mockResolvedValue({ profile: null, targets: null, connected: false });
    const first = render(<App />);
    const layer = await screen.findByRole('dialog');

    fireEvent.keyDown(layer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Set goal')).toBeTruthy();
    expect(localStorage.getItem('snapbite.onboarding.keyDecision')).toBeNull();

    // The next launch (a fresh mount, same storage) shows the welcome again.
    first.unmount();
    clearCache();
    render(<App />);
    await screen.findByRole('dialog');
  });

  it('opens again from the Set goal card after a skip', async () => {
    getSettings.mockResolvedValue({ profile: null, targets: null, connected: false });
    render(<App />);
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    fireEvent.click(await screen.findByText('Set goal'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });

  it('never shows the welcome to an account that has a profile', async () => {
    getSettings.mockResolvedValue({
      profile: { sex: 'female' },
      targets: { energyKcal: 2000, proteinG: 120, carbsG: 250, fatG: 70 },
      connected: true,
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/kcal/)).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends a profile without targets to Home with the Set goal card, not the welcome', async () => {
    getSettings.mockResolvedValue({ profile: { sex: 'female' }, targets: null, connected: true });
    render(<App />);
    expect(await screen.findByText('Set goal')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not guess "no profile" when the server cannot be reached', async () => {
    getSettings.mockRejectedValue(new Error('offline'));
    render(<App />);
    expect(await screen.findByText('Set goal')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('still asks about the AI key once, and respects the answer', async () => {
    const profile = { profile: { sex: 'female' }, targets: null, connected: false };

    getSettings.mockResolvedValue(profile);
    const first = render(<App />);
    await screen.findByRole('dialog');
    first.unmount();
    clearCache();

    localStorage.setItem('snapbite.onboarding.keyDecision', 'skipped');
    getSettings.mockResolvedValue(profile);
    render(<App />);
    expect(await screen.findByText('Set goal')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
