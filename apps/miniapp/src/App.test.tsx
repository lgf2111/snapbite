import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('first-run onboarding', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    getSettings.mockReset();
  });

  it('opens the setup sheet for a brand-new visitor', async () => {
    getSettings.mockResolvedValue({ profile: null, targets: null, connected: false });
    render(<App />);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });

  it('does not reopen the sheet once the visitor has dismissed it', async () => {
    localStorage.setItem('snapbite.onboarding.keyDecision', 'skipped');
    getSettings.mockResolvedValue({ profile: null, targets: null, connected: false });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Set goal')).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('still opens from the Set goal button after a dismissal', async () => {
    localStorage.setItem('snapbite.onboarding.keyDecision', 'skipped');
    getSettings.mockResolvedValue({ profile: null, targets: null, connected: false });
    render(<App />);
    fireEvent.click(await screen.findByText('Set goal'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });
});
