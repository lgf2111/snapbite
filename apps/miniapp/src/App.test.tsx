import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSettings = vi.hoisted(() => vi.fn());
const backendMode = vi.hoisted(() => ({ mode: 'local' as 'local' | 'worker' }));
vi.mock('./lib/backend.js', async (orig) => ({
  ...(await orig<typeof import('./lib/backend.js')>()),
  createBackend: () => ({
    // A getter: App builds its backend once at import, tests pick the mode per case.
    get mode() {
      return backendMode.mode;
    },
    getSettings,
    mealsByDate: async () => [],
    mealsInRange: async () => [],
    mealDates: async () => ({ dates: [], streak: 0 }),
    listFavorites: async () => [],
    analyze: async () => ({
      foods: [
        {
          food: { name: 'Grilled salmon', estimatedWeightG: 180, confidence: 0.9 },
          nutrition: { energyKcal: 612, proteinG: 40, carbsG: 0, fatG: 38, source: 'ai' },
        },
      ],
      total: { energyKcal: 612, proteinG: 40, carbsG: 0, fatG: 38, source: 'ai' },
      confidence: 0.9,
      needsConfirmation: false,
    }),
    logWithPhoto: async () => {},
  }),
}));
vi.mock('./lib/compress.js', () => ({
  compressPhoto: vi.fn(async (file: File) => ({
    base64: `b64:${file.name}`,
    mimeType: 'image/jpeg',
    bytes: 1,
    width: 1,
    height: 1,
  })),
}));

import { App } from './App.js';
import { resetAuthStatus } from './lib/account.js';
import { clearCache } from './lib/cache.js';
import { resetLaunchIntent } from './lib/launch.js';

afterEach(() => {
  resetLaunchIntent();
  vi.unstubAllGlobals();
});

describe('first-run onboarding', () => {
  // Test files share one DOM (single fork): leave nothing mounted behind.
  afterEach(cleanup);

  beforeEach(() => {
    cleanup();
    clearCache();
    resetAuthStatus();
    localStorage.clear();
    getSettings.mockReset();
    backendMode.mode = 'local';
    window.history.replaceState({}, '', '/');
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

  it('does not restart setup for an account that has a profile but no AI key', async () => {
    getSettings.mockResolvedValue({ profile: { sex: 'female' }, targets: null, connected: false });

    // Nothing remembered on this device, and then a stale "skipped": same result.
    for (const remembered of [null, 'skipped', 'set']) {
      clearCache();
      localStorage.clear();
      if (remembered) localStorage.setItem('snapbite.onboarding.keyDecision', remembered);
      const view = render(<App />);
      expect(await screen.findByText('Set goal')).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
      view.unmount();
    }
  });

  it('trusts the server over a cached "no profile" left by another account', async () => {
    // The anonymous account's settings, cached before signing in as someone else.
    localStorage.setItem(
      'snapbite.cache.settings',
      JSON.stringify({
        at: Date.now(),
        value: { profile: null, targets: null, connected: false },
      }),
    );
    getSettings.mockResolvedValue({
      profile: { sex: 'female' },
      targets: { energyKcal: 2000, proteinG: 120, carbsG: 250, fatG: 70 },
      connected: true,
    });
    render(<App />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/kcal/)).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('boot: who is this browser?', () => {
  const ME = (over: Record<string, unknown> = {}) => ({
    signedIn: true,
    via: 'session',
    method: 'google',
    email: 'ada@example.com',
    userId: 'u1',
    ...over,
  });
  const NOTHING = { profile: null, targets: null, connected: false };

  /** Answer /api/auth/me with `me` (or reject); `gate` holds the answer back. */
  function serve(me: unknown | 'fail', gate?: Promise<void>) {
    backendMode.mode = 'worker';
    vi.stubEnv('VITE_WORKER_URL', 'https://worker.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (gate) await gate;
        if (me === 'fail') throw new TypeError('Failed to fetch');
        return Response.json(url.endsWith('/providers') ? { email: false, google: true } : me);
      }),
    );
  }

  beforeEach(() => {
    cleanup();
    clearCache();
    resetAuthStatus();
    localStorage.clear();
    getSettings.mockReset();
    window.history.replaceState({}, '', '/');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    backendMode.mode = 'local';
  });

  it('a signed-in cold start with no profile opens on the form, with no welcome at all', async () => {
    serve(ME());
    getSettings.mockResolvedValue(NOTHING);
    render(<App />);

    const layer = await screen.findByRole('dialog');
    // The form fields are there...
    expect(await within(layer).findByTestId('onboarding-form')).toBeTruthy();
    expect(layer.querySelector('input[type=date]')).toBeTruthy();
    // ...and none of the welcome: no panel, heading, one-second cue or sign-in link.
    expect(within(layer).queryByTestId('onboarding-intro')).toBeNull();
    expect(within(layer).queryByRole('heading', { name: /welcome/i })).toBeNull();
    expect(within(layer).queryByTestId('scroll-cue')).toBeNull();
    expect(within(layer).queryByTestId('signin-link')).toBeNull();
    // They are told who they are signed in as, and no skeleton plays.
    expect(within(layer).getByText('Signed in as ada@example.com')).toBeTruthy();
    expect(within(layer).queryByTestId('onboarding-skeleton')).toBeNull();
  });

  it('does not depend on the skip flag: a signed-in account is not a skipped one', async () => {
    localStorage.setItem('snapbite.onboarding.keyDecision', 'skipped');
    serve(ME());
    getSettings.mockResolvedValue(NOTHING);
    render(<App />);
    expect(await screen.findByTestId('onboarding-form')).toBeTruthy();
  });

  it('a signed-in account with a profile opens Home, not setup', async () => {
    serve(ME());
    getSettings.mockResolvedValue({
      profile: { sex: 'female' },
      targets: { energyKcal: 2000, proteinG: 120, carbsG: 250, fatG: 70 },
      connected: true,
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/kcal/)).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('an anonymous visitor with no profile gets the welcome', async () => {
    serve(ME({ signedIn: false, via: null, method: null, email: null, userId: null }));
    getSettings.mockResolvedValue(NOTHING);
    render(<App />);
    expect(await screen.findByTestId('onboarding-intro')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-form')).toBeNull();
  });

  it('falls back to the welcome when /api/auth/me fails, never guessing signed-in', async () => {
    serve('fail');
    getSettings.mockResolvedValue(NOTHING);
    render(<App />);
    expect(await screen.findByTestId('onboarding-intro')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-form')).toBeNull();
  });

  it('holds the welcome back until /api/auth/me has answered', async () => {
    const gate = { release: () => {} };
    const held = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    serve(ME(), held);
    getSettings.mockResolvedValue(NOTHING);
    render(<App />);

    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('onboarding-intro')).toBeNull();

    gate.release();
    expect(await screen.findByTestId('onboarding-form')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-intro')).toBeNull();
  });
});

describe('boot: what ?auth= on the landing URL does', () => {
  const NOTHING = { profile: null, targets: null, connected: false };
  const ANON = { signedIn: false, via: null, method: null, email: null, userId: null };

  function serve(me: unknown) {
    backendMode.mode = 'worker';
    vi.stubEnv('VITE_WORKER_URL', 'https://worker.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(me)),
    );
  }
  beforeEach(() => {
    cleanup();
    clearCache();
    resetAuthStatus();
    localStorage.clear();
    getSettings.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    backendMode.mode = 'local';
    window.history.replaceState({}, '', '/');
  });

  it('?auth=ok with a confirmed session says who is signed in, and is removed from the URL', async () => {
    window.history.replaceState({}, '', '/?auth=ok');
    serve({
      signedIn: true,
      via: 'session',
      method: 'google',
      email: 'ada@example.com',
      userId: 'u',
    });
    getSettings.mockResolvedValue(NOTHING);
    render(<App />);

    expect(
      await screen.findByText('Signed in as ada@example.com', { selector: '[data-title]' }),
    ).toBeTruthy();
    expect(window.location.search).toBe('');
  });

  it('?auth=ok without a session says the browser did not keep it, instead of doing nothing', async () => {
    window.history.replaceState({}, '', '/?auth=ok');
    serve(ANON);
    getSettings.mockResolvedValue(NOTHING);
    render(<App />);

    expect(await screen.findByText(/did not keep the session/i)).toBeTruthy();
    expect(window.location.search).toBe('');
  });

  it('a failed sign-in says why', async () => {
    window.history.replaceState({}, '', '/?auth=conflict&keep=1');
    serve(ANON);
    getSettings.mockResolvedValue(NOTHING);
    render(<App />);

    expect(await screen.findByText(/already belongs to another account/i)).toBeTruthy();
    // Only ?auth is consumed.
    expect(window.location.search).toBe('?keep=1');
  });
});

describe('boot: icon shortcuts and a shared photo', () => {
  const READY = {
    profile: { sex: 'female' },
    targets: { energyKcal: 2000, proteinG: 120, carbsG: 250, fatG: 70 },
    connected: true,
  };

  beforeEach(() => {
    cleanup();
    clearCache();
    localStorage.clear();
    getSettings.mockReset();
    getSettings.mockResolvedValue(READY);
    resetLaunchIntent();
  });
  afterEach(() => {
    cleanup();
    resetLaunchIntent();
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  it('?capture=camera opens the menu on the Take photo card, clears the parameter, and never clicks the picker', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    window.history.replaceState({}, '', '/?capture=camera');
    render(<App />);

    const menu = await screen.findByTestId('capture-menu');
    const takePhoto = within(menu).getByRole('button', { name: /take photo/i });
    await waitFor(() => expect(takePhoto).toHaveFocus());
    expect(takePhoto).toHaveAttribute('data-highlighted', 'true');
    // The launch opened a surface; it did not fake a file-picker click.
    expect(click).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it('?shared=1 picks the photo out of the handoff and opens the review sheet with it attached', async () => {
    const photo = new Response(new TextEncoder().encode('shared-jpeg'), {
      headers: { 'content-type': 'image/jpeg', 'x-filename': 'lunch.jpg' },
    });
    vi.stubGlobal('caches', {
      open: vi.fn(async () => ({
        match: vi.fn(async () => photo),
        delete: vi.fn(async () => true),
      })),
    });
    window.history.replaceState({}, '', '/?shared=1');
    render(<App />);

    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText('Log this meal?')).toBeTruthy();
    // The photo went through the normal analyse → review path, pre-attached.
    expect(within(sheet).getByText('Grilled salmon')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Save meal' })).toBeTruthy();
    expect(window.location.search).toBe('');
  });
});
