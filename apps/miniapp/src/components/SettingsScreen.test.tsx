import type { SettingsView } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import { clearCache } from '@/lib/cache';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsScreen } from './SettingsScreen.js';

const SETTINGS: SettingsView = {
  aiProvider: 'gemini',
  aiModel: null,
  connected: false,
  keyLast4: null,
  profile: {
    sex: 'female',
    age: 31,
    heightCm: 165,
    weightKg: 65,
    activity: 'moderate',
    goal: 'lose_steady',
    units: 'metric',
    mode: 'simple',
  },
  targets: { energyKcal: 1800, proteinG: 120, carbsG: 180, fatG: 60 },
  reminders: null,
  adaptive: null,
  latestWeightKg: 72.4,
};

function stubBackend(getSettings: () => Promise<SettingsView>): Backend {
  return { mode: 'local', getSettings } as unknown as Backend;
}

afterEach(() => {
  cleanup();
  clearCache();
  localStorage.clear();
});

describe('SettingsScreen', () => {
  it('groups ruled sections under caption labels, with no cards', async () => {
    render(<SettingsScreen backend={stubBackend(async () => SETTINGS)} />);

    expect(await screen.findByRole('heading', { level: 3, name: 'Goal and targets' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: /Today.s targets/ })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Logging and AI' })).toBeTruthy();
    expect(screen.getByText('Lose steady · female, 31y')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit goal' }).className).toContain('bg-secondary');
    expect(document.querySelector('[data-slot="card"]')).toBeNull();

    for (const title of ['Meal reminders', 'Adaptive targets', 'Weekly view', 'AI key']) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toBeTruthy();
    }
  });

  it('draws one skeleton per group while settings load', () => {
    render(<SettingsScreen backend={stubBackend(() => new Promise<SettingsView>(() => {}))} />);

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(4);
    const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons).toHaveLength(4);
    for (const skeleton of skeletons) expect(skeleton.className).toContain('h-24');
  });

  it('reports a failed load in place instead of a toast', async () => {
    render(<SettingsScreen backend={stubBackend(() => Promise.reject(new Error('offline')))} />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Could not load settings. Check the connection and open Settings again.',
    );
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
  });
});
