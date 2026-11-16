import type { SettingsView } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import { cacheKey, clearCache, getCached, setCached } from '@/lib/cache';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

/** A worker-mode view: primary key connected, fallback saved but switched off. */
const WORKER_SETTINGS: SettingsView = {
  ...SETTINGS,
  connected: true,
  keyLast4: '1111',
  fallbackConnected: true,
  fallbackEnabled: false,
  fallbackProvider: 'openai',
  fallbackModel: 'gpt-4o-mini',
  fallbackKeyLast4: '2222',
};

const BILLING_SUMMARY = {
  signedIn: false,
  email: null,
  supporter: false,
  credits: 0,
  source: 'byok' as const,
  trialUntil: null,
  trialAvailable: false,
  overflowEnabled: false,
  overflowUsedToday: 0,
  overflowCap: 0,
  packs: [],
};

function stubBackend(
  getSettings: () => Promise<SettingsView>,
  overrides: Record<string, unknown> = {},
): Backend {
  return { mode: 'local', getSettings, ...overrides } as unknown as Backend;
}

/** Worker mode renders the credits/shortcut cards, so those reads need stubs. */
function workerBackend(overrides: Record<string, unknown> = {}): Backend {
  return {
    mode: 'worker',
    billingSummary: async () => BILLING_SUMMARY,
    listDeviceTokens: async () => [],
    getSettings: async () => WORKER_SETTINGS,
    ...overrides,
  } as unknown as Backend;
}

function cachedSettings(): SettingsView | undefined {
  return getCached<SettingsView>(cacheKey.settings());
}

/** The raw sessionStorage entry a reload/new mount would warm from. */
function persistedSettings(): SettingsView | undefined {
  const raw = sessionStorage.getItem('snapbite.cache.settings');
  if (!raw) return undefined;
  return (JSON.parse(raw) as { value: SettingsView }).value;
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

    // Each ruled section carries at most one primary action.
    for (const section of document.querySelectorAll('section')) {
      const primaries = [...section.querySelectorAll<HTMLElement>('[data-slot="button"]')].filter(
        (b) => b.className.includes('bg-primary'),
      );
      expect(primaries.length).toBeLessThanOrEqual(1);
    }
  });

  it('draws one skeleton per group while settings load', () => {
    render(<SettingsScreen backend={stubBackend(() => new Promise<SettingsView>(() => {}))} />);

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(4);
    const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons).toHaveLength(4);
    for (const skeleton of skeletons) expect(skeleton.className).toContain('h-24');
  });

  it('paints cached settings on first load, with no skeleton, then revalidates', async () => {
    setCached(cacheKey.settings(), SETTINGS);
    let resolve!: (settings: SettingsView) => void;
    const backend = stubBackend(
      () =>
        new Promise<SettingsView>((done) => {
          resolve = done;
        }),
    );

    render(<SettingsScreen backend={backend} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(screen.getByText('Lose steady · female, 31y')).toBeTruthy();
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);

    await act(async () => {
      resolve(SETTINGS);
      await Promise.resolve();
    });
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

  it('keeps adaptive off through a remount and a stale background fetch', async () => {
    const on: SettingsView = {
      ...SETTINGS,
      adaptive: { enabled: true, tzOffsetMinutes: -480 },
    };
    setCached(cacheKey.settings(), on);
    // Both mounts leave their fetch pending so the cache is the only source.
    const pending: Array<(settings: SettingsView) => void> = [];
    const getSettings = vi.fn(() => new Promise<SettingsView>((resolve) => pending.push(resolve)));
    const saveAdaptive = vi.fn(async () => ({
      ok: true,
      adaptive: { enabled: false, tzOffsetMinutes: -480 },
    }));
    const backend = stubBackend(getSettings, { saveAdaptive });

    const first = render(<SettingsScreen backend={backend} />);
    expect(
      screen.getByRole('switch', { name: 'Enable adaptive targets' }).getAttribute('aria-checked'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('switch', { name: 'Enable adaptive targets' }));
    await waitFor(() => expect(cachedSettings()?.adaptive?.enabled).toBe(false));
    expect(saveAdaptive).toHaveBeenCalledWith(false);
    expect(persistedSettings()?.adaptive?.enabled).toBe(false);
    first.unmount();

    // Remount: the cache paints off on the first frame, with no skeleton.
    render(<SettingsScreen backend={backend} />);
    expect(pending).toHaveLength(2);
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
    expect(
      screen.getByRole('switch', { name: 'Enable adaptive targets' }).getAttribute('aria-checked'),
    ).toBe('false');

    // The GET started before the toggle and still carries `enabled: true`.
    // The mutation window must keep the local value instead of repainting it.
    await act(async () => {
      pending[1]?.(on);
      await Promise.resolve();
    });
    expect(
      screen.getByRole('switch', { name: 'Enable adaptive targets' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(cachedSettings()?.adaptive?.enabled).toBe(false);
  });

  it('patches only adaptive when the save returns a partial response', async () => {
    const tzOffsetMinutes = new Date().getTimezoneOffset();
    const reminders = { enabled: true, times: { breakfast: '08:00' }, tzOffsetMinutes };
    const seeded: SettingsView = {
      ...SETTINGS,
      reminders,
      adaptive: { enabled: true, tzOffsetMinutes },
    };
    setCached(cacheKey.settings(), seeded);
    const backend = stubBackend(async () => seeded, {
      saveAdaptive: async () => ({
        ok: true,
        adaptive: { enabled: false, tzOffsetMinutes },
      }),
    });

    render(<SettingsScreen backend={backend} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Enable adaptive targets' }));
    await waitFor(() => expect(cachedSettings()?.adaptive?.enabled).toBe(false));

    const cached = cachedSettings();
    expect(cached?.profile).toEqual(SETTINGS.profile);
    expect(cached?.targets).toEqual(SETTINGS.targets);
    expect(cached?.reminders).toEqual(reminders);
    expect(cached?.latestWeightKg).toBe(72.4);
    expect(screen.getByText('Lose steady · female, 31y')).toBeTruthy();
    expect(
      screen
        .getByRole('switch', { name: 'Enable breakfast reminder' })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('rewrites the cache and sessionStorage when reminders are saved', async () => {
    setCached(cacheKey.settings(), SETTINGS);
    const backend = stubBackend(async () => SETTINGS, {
      saveReminders: async () => ({
        ok: true,
        reminders: {
          enabled: true,
          times: { breakfast: '08:00' },
          tzOffsetMinutes: new Date().getTimezoneOffset(),
        },
      }),
    });

    render(<SettingsScreen backend={backend} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Enable breakfast reminder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(cachedSettings()?.reminders?.enabled).toBe(true));
    expect(persistedSettings()?.reminders?.times).toEqual({ breakfast: '08:00' });
    expect(persistedSettings()?.profile).toEqual(SETTINGS.profile);
  });

  it('rewrites the cache and sessionStorage when a weight is logged', async () => {
    setCached(cacheKey.settings(), SETTINGS);
    const backend = stubBackend(async () => SETTINGS, {
      logWeight: async () => ({ ok: true, latestWeightKg: 71.6 }),
    });

    render(<SettingsScreen backend={backend} />);
    fireEvent.change(screen.getByLabelText('Log weight (kg)'), { target: { value: '71.6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log weight' }));

    await waitFor(() => expect(cachedSettings()?.latestWeightKg).toBe(71.6));
    expect(persistedSettings()?.latestWeightKg).toBe(71.6);
    expect(persistedSettings()?.profile).toEqual(SETTINGS.profile);
  });

  it('rewrites the cache and sessionStorage when the goal is saved', async () => {
    setCached(cacheKey.settings(), SETTINGS);
    const targets = { energyKcal: 1750, proteinG: 115, carbsG: 170, fatG: 58 };
    const backend = stubBackend(async () => SETTINGS, { saveProfile: async () => targets });

    render(<SettingsScreen backend={backend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit goal' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save goal' }));

    await waitFor(() => expect(cachedSettings()?.targets).toEqual(targets));
    expect(persistedSettings()?.targets?.energyKcal).toBe(1750);
    // ProfileForm rewrites age as a birth date; the stable fields must survive.
    expect(persistedSettings()?.profile).toMatchObject({
      sex: 'female',
      heightCm: 165,
      weightKg: 65,
      goal: 'lose_steady',
      activity: 'moderate',
      units: 'metric',
    });
  });

  it('rewrites the cache when fallback is enabled, saved and removed', async () => {
    setCached(cacheKey.settings(), WORKER_SETTINGS);
    const backend = workerBackend({
      setFallbackEnabled: async () => ({ ok: true, fallbackEnabled: true }),
      saveFallback: async () => ({
        ...WORKER_SETTINGS,
        fallbackEnabled: true,
        fallbackKeyLast4: '9999',
      }),
      removeFallback: async () => ({ ok: true, fallbackConnected: false }),
    });

    render(<SettingsScreen backend={backend} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Enable fallback provider' }));
    await waitFor(() => expect(cachedSettings()?.fallbackEnabled).toBe(true));
    expect(persistedSettings()?.fallbackEnabled).toBe(true);

    // Saving a replacement key keeps the enabled switch from the response.
    fireEvent.change(await screen.findByLabelText('Fallback API key'), {
      target: { value: 'sk-fallback' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save fallback' }));
    await waitFor(() => expect(cachedSettings()?.fallbackKeyLast4).toBe('9999'));
    expect(persistedSettings()?.fallbackKeyLast4).toBe('9999');

    fireEvent.click(await screen.findByRole('button', { name: 'Remove fallback' }));
    await waitFor(() => expect(cachedSettings()?.fallbackConnected).toBe(false));
    expect(persistedSettings()?.fallbackConnected).toBe(false);
    expect(persistedSettings()?.profile).toEqual(SETTINGS.profile);
  });

  it('rewrites the cache when a primary API key is saved', async () => {
    setCached(cacheKey.settings(), WORKER_SETTINGS);
    const backend = workerBackend({
      saveApiKey: async () => ({ ...WORKER_SETTINGS, keyLast4: 'abcd' }),
    });

    render(<SettingsScreen backend={backend} />);
    fireEvent.click(screen.getByRole('button', { name: /AI key/ }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-primary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    await waitFor(() => expect(cachedSettings()?.keyLast4).toBe('abcd'));
    expect(persistedSettings()?.keyLast4).toBe('abcd');
    expect(persistedSettings()?.profile).toEqual(SETTINGS.profile);
  });

  it('keeps a connected AI key as one collapsed row naming provider, model and status', async () => {
    setCached(cacheKey.settings(), WORKER_SETTINGS);
    render(<SettingsScreen backend={workerBackend()} />);

    const row = await screen.findByRole('button', { name: /AI key/ });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(row.textContent).toContain('Gemini · gemini-3.6-flash');
    expect(row.textContent).toContain('Connected');
    // The form is not on screen until asked for.
    expect(screen.queryByRole('button', { name: 'Save key' })).toBeNull();
  });

  it('expands a connected AI key on tap and collapses it again', async () => {
    setCached(cacheKey.settings(), WORKER_SETTINGS);
    render(<SettingsScreen backend={workerBackend()} />);

    const row = await screen.findByRole('button', { name: /AI key/ });
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Save key' })).toBeTruthy();

    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Save key' })).toBeNull();
  });

  it('opens the AI key form by default when the account is not connected', async () => {
    setCached(cacheKey.settings(), SETTINGS);
    render(<SettingsScreen backend={workerBackend({ getSettings: async () => SETTINGS })} />);

    const row = await screen.findByRole('button', { name: /AI key/ });
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('API key')).toBeTruthy();
  });

  it('toggles the AI key row with Enter and Space', async () => {
    const user = userEvent.setup();
    setCached(cacheKey.settings(), WORKER_SETTINGS);
    render(<SettingsScreen backend={workerBackend()} />);

    const row = await screen.findByRole('button', { name: /AI key/ });
    row.focus();
    await user.keyboard('{Enter}');
    expect(row.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard(' ');
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });

  it('remembers the AI key open choice across a remount this session', async () => {
    setCached(cacheKey.settings(), WORKER_SETTINGS);
    const backend = workerBackend();
    const first = render(<SettingsScreen backend={backend} />);

    fireEvent.click(await screen.findByRole('button', { name: /AI key/ }));
    first.unmount();

    render(<SettingsScreen backend={backend} />);
    const row = await screen.findByRole('button', { name: /AI key/ });
    expect(row.getAttribute('aria-expanded')).toBe('true');
  });

  it('rewrites the cache after the account is deleted', async () => {
    setCached(cacheKey.settings(), SETTINGS);
    const fresh: SettingsView = {
      ...SETTINGS,
      connected: false,
      keyLast4: null,
      profile: null,
      targets: null,
      latestWeightKg: null,
    };
    const getSettings = vi
      .fn<() => Promise<SettingsView>>()
      .mockResolvedValueOnce(SETTINGS)
      .mockResolvedValueOnce(fresh);
    const backend = stubBackend(getSettings, { deleteAccount: async () => {} });

    render(<SettingsScreen backend={backend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete everything' }));

    await waitFor(() => expect(cachedSettings()?.profile).toBeNull());
    expect(persistedSettings()?.profile).toBeNull();
  });

  it('persists the weekly-view choice to localStorage, not the settings cache', () => {
    setCached(cacheKey.settings(), SETTINGS);
    render(<SettingsScreen backend={stubBackend(async () => SETTINGS)} />);

    fireEvent.click(screen.getByText('Calendar week').closest('button') as HTMLElement);

    expect(JSON.parse(localStorage.getItem('snapbite.weekPrefs.v1') ?? '{}')).toEqual({
      mode: 'calendar',
      weekStart: 'monday',
    });
    expect(cachedSettings()).toEqual(SETTINGS);
  });
});
