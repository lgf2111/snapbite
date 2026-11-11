import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../lib/backend.js';
import { OnboardingScreen } from './OnboardingScreen.js';

function makeBackend(mode: 'worker' | 'local' = 'worker') {
  const saveProfile = vi.fn().mockResolvedValue({
    energyKcal: 2000,
    proteinG: 120,
    carbsG: 250,
    fatG: 70,
  });
  const saveApiKey = vi.fn().mockResolvedValue({});
  const backend = { mode, saveProfile, saveApiKey } as unknown as Backend;
  return { backend, saveProfile, saveApiKey };
}

const realMatchMedia = window.matchMedia;
function setReduced(reduced: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: reduced && q.includes('reduce'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

/** Test files share one DOM (single fork): restore globals and leave nothing mounted. */
function restore() {
  window.matchMedia = realMatchMedia;
  cleanup();
}

/** jsdom has no layout: give the scroller a viewport and scroll it. */
function scrollTo(top: number) {
  const scroller = screen.getByTestId('onboarding-scroller');
  Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(scroller, 'scrollTop', { value: top, configurable: true });
  fireEvent.scroll(scroller);
}

const renderScreen = (extra: Record<string, unknown> = {}) => {
  const made = makeBackend();
  const utils = render(
    <OnboardingScreen backend={made.backend} onDone={vi.fn()} onSkip={vi.fn()} {...extra} />,
  );
  return { ...made, ...utils };
};

describe('OnboardingScreen resume', () => {
  afterEach(restore);
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    setReduced(true);
  });

  it('opens at the key step when the profile is already saved', () => {
    renderScreen({ startAtKeyStep: true });
    expect(screen.getByText(/Add your AI key/i)).toBeTruthy();
    // The key step is one page, not the two snap panels.
    expect(screen.queryByTestId('onboarding-scroller')).toBeNull();
  });

  it('records the key step so a reload resumes there', async () => {
    const { saveProfile } = renderScreen();
    scrollTo(800);

    const dob = (await screen.findByTestId('onboarding-form')).querySelector(
      'input[type=date]',
    ) as HTMLInputElement;
    fireEvent.change(dob, { target: { value: '1990-05-05' } });
    fireEvent.click(screen.getByRole('button', { name: /set my goal/i }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(/Add your AI key/i).length).toBeGreaterThan(0));

    const saved = JSON.parse(localStorage.getItem('snapbite.onboarding.resume') ?? '{}');
    expect(saved.step).toBe('apikey');
    expect(JSON.stringify(saved)).not.toMatch(/apiKey|AIza/);
  });

  it('writes nothing to the resume record just by opening the welcome', () => {
    renderScreen();
    expect(localStorage.getItem('snapbite.onboarding.resume')).toBeNull();
  });

  it('ignores a stale "profile" record left by older builds and opens the welcome', () => {
    localStorage.setItem(
      'snapbite.onboarding.resume',
      JSON.stringify({ step: 'profile', provider: 'gemini' }),
    );
    renderScreen();
    expect(screen.getByTestId('onboarding-intro')).toBeTruthy();
    expect(screen.queryByText(/Add your AI key/i)).toBeNull();
  });

  it('reopens the key step only when the user genuinely left it', () => {
    localStorage.setItem(
      'snapbite.onboarding.resume',
      JSON.stringify({ step: 'apikey', provider: 'openai' }),
    );
    renderScreen();
    expect(screen.getByText(/Add your AI key/i)).toBeTruthy();
  });

  it('clears the resume record once onboarding finishes', async () => {
    const onSkip = vi.fn();
    renderScreen({ startAtKeyStep: true, onSkip });

    fireEvent.click(screen.getByRole('button', { name: /track meals manually/i }));

    await waitFor(() => expect(onSkip).toHaveBeenCalled());
    expect(localStorage.getItem('snapbite.onboarding.resume')).toBeNull();
  });
});

describe('OnboardingScreen motion', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.useFakeTimers();
    setReduced(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    restore();
  });

  it('opens on the welcome, with the scroll cue only after about a second', () => {
    renderScreen();
    expect(screen.getByTestId('onboarding-intro')).toBeTruthy();
    expect(screen.queryByTestId('scroll-cue')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.queryByTestId('scroll-cue')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    const cue = screen.getByTestId('scroll-cue');
    expect(cue.textContent).toMatch(/scroll down/i);
    // The arrow is decoration; the words are what assistive tech reads.
    expect(cue.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is two snap panels using native scroll-snap', () => {
    renderScreen();
    const scroller = screen.getByTestId('onboarding-scroller');
    expect(scroller.className).toMatch(/h-\[100svh\].*snap-y|snap-y.*h-\[100svh\]/);
    expect(scroller.className).toContain('snap-mandatory');
    // The form panel shrinks above the keyboard; the intro has no field to protect.
    const heights: Record<string, string> = {
      'onboarding-intro': 'h-[100svh]',
      'onboarding-form-panel': 'h-[calc(100svh-var(--keyboard-inset,0px))]',
    };
    for (const id of ['onboarding-intro', 'onboarding-form-panel']) {
      const panel = screen.getByTestId(id);
      expect(panel.className).toContain(heights[id] as string);
      expect(panel.className).toContain('snap-start');
      expect(panel.className).toContain('snap-always');
    }
  });

  it('mounts the form on reaching panel two, behind a one-time skeleton', () => {
    renderScreen();
    expect(screen.queryByTestId('onboarding-form')).toBeNull();
    expect(document.querySelector('input[type=date]')).toBeNull();

    scrollTo(800);
    expect(screen.getByTestId('onboarding-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-form')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(screen.queryByTestId('onboarding-skeleton')).toBeNull();
    expect(screen.getByTestId('onboarding-form')).toBeTruthy();

    // Back and forth again: no second skeleton.
    scrollTo(0);
    scrollTo(800);
    expect(screen.queryByTestId('onboarding-skeleton')).toBeNull();
    expect(screen.getByTestId('onboarding-form')).toBeTruthy();
  });

  it('keeps what was typed when scrolling back to the welcome', () => {
    renderScreen();
    scrollTo(800);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    const dob = document.querySelector('input[type=date]') as HTMLInputElement;
    fireEvent.change(dob, { target: { value: '1990-05-05' } });

    scrollTo(0);

    const still = document.querySelector('input[type=date]') as HTMLInputElement;
    expect(still).toBe(dob);
    expect(still.value).toBe('1990-05-05');
  });

  it('tapping the cue brings the form in', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderScreen();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(screen.getByTestId('scroll-cue'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('onboarding-skeleton')).toBeTruthy();
  });

  it('can be skipped from both panels', () => {
    const onSkip = vi.fn();
    renderScreen({ onSkip });
    expect(screen.getAllByRole('button', { name: /skip for now/i })).toHaveLength(1);

    scrollTo(800);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    const buttons = screen.getAllByRole('button', { name: /skip for now/i });
    expect(buttons).toHaveLength(2);
    for (const b of buttons) fireEvent.click(b);
    expect(onSkip).toHaveBeenCalledTimes(2);
  });

  it('switches snapping off while a field has focus, and back on after', () => {
    renderScreen();
    scrollTo(800);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    const scroller = screen.getByTestId('onboarding-scroller');
    const field = within(screen.getByTestId('onboarding-form')).getAllByRole('spinbutton')[0];
    expect(scroller.className).toContain('snap-mandatory');

    act(() => field?.focus());
    expect(scroller.className).toContain('snap-none');
    expect(scroller.className).not.toContain('snap-mandatory');

    act(() => field?.blur());
    expect(scroller.className).toContain('snap-mandatory');
  });

  it('keeps the bottom reserve so the submit button clears the keyboard', () => {
    renderScreen();
    const panel = screen.getByTestId('onboarding-form-panel');
    expect(panel.className).toContain('scroll-pb-28');
    expect(panel.className).toContain('env(safe-area-inset-bottom)');
  });
});

describe('OnboardingScreen under reduced motion', () => {
  afterEach(restore);
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    setReduced(true);
  });

  it('has the cue present at once, no loop, and the form as soon as it is reached', () => {
    renderScreen();
    const cue = screen.getByTestId('scroll-cue');
    expect(cue).toBeTruthy();
    // The drift is only ever applied behind `motion-safe:`.
    expect(cue.innerHTML).not.toMatch(/(^|[\s"])animate-drift/);

    scrollTo(800);
    expect(screen.queryByTestId('onboarding-skeleton')).toBeNull();
    expect(screen.getByTestId('onboarding-form')).toBeTruthy();
  });
});

describe('OnboardingScreen sign-in for existing accounts', () => {
  const TARGETS = { energyKcal: 1900, proteinG: 110, carbsG: 220, fatG: 60 };
  let signedIn = false;

  function stubServer() {
    vi.stubEnv('VITE_WORKER_URL', 'https://worker.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(
          url.endsWith('/providers')
            ? { email: true, google: true }
            : {
                signedIn,
                via: signedIn ? 'session' : null,
                method: signedIn ? 'google' : null,
                email: signedIn ? 'ada@example.com' : null,
                userId: 'u1',
              },
        ),
      ),
    );
  }

  function renderWith(getSettings: () => Promise<unknown>, extra: Record<string, unknown> = {}) {
    const made = makeBackend();
    const backend = { ...made.backend, getSettings } as unknown as Backend;
    const onDone = vi.fn();
    render(<OnboardingScreen backend={backend} onDone={onDone} onSkip={vi.fn()} {...extra} />);
    return { onDone };
  }

  beforeEach(() => {
    cleanup();
    localStorage.clear();
    signedIn = false;
    setReduced(true);
    stubServer();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    restore();
  });

  it('offers a quiet 44px sign-in on the welcome panel, not a second sign-up', () => {
    renderWith(async () => ({}));
    const link = screen.getByRole('button', { name: /already have an account\? sign in/i });
    expect(link.className).toContain('min-h-11');
    // Text, not a filled button: no background fill classes.
    expect(link.className).not.toMatch(/\bbg-/);
    expect(screen.queryByText(/sign up/i)).toBeNull();
    expect(screen.getByTestId('onboarding-intro').contains(link)).toBe(true);
  });

  it('is absent without a server to sign in to', () => {
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_WORKER_URL', '');
    renderWith(async () => ({}));
    expect(screen.queryByTestId('signin-link')).toBeNull();
  });

  it('opens the sign-in surface full-screen, and Back returns with the form intact', async () => {
    renderWith(async () => ({}));
    scrollTo(800);
    const dob = document.querySelector('input[type=date]') as HTMLInputElement;
    fireEvent.change(dob, { target: { value: '1990-05-05' } });

    fireEvent.click(screen.getByTestId('signin-link'));

    const surface = screen.getByTestId('onboarding-signin');
    expect(surface.className).toContain('absolute inset-0');
    expect(within(surface).getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(await within(surface).findByRole('link', { name: 'Continue with Google' })).toBeTruthy();
    // The panels underneath are unreachable while it is up, but still mounted.
    expect(screen.getByTestId('onboarding-scroller').hasAttribute('inert')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Back to welcome' }));

    expect(screen.queryByTestId('onboarding-signin')).toBeNull();
    expect(screen.getByTestId('onboarding-scroller').hasAttribute('inert')).toBe(false);
    expect(document.querySelector('input[type=date]')).toBe(dob);
    expect(dob.value).toBe('1990-05-05');
  });

  it("the phone's Back closes sign-in instead of leaving setup", () => {
    renderWith(async () => ({}));
    fireEvent.click(screen.getByTestId('signin-link'));
    expect(window.history.state?.sbSignIn).toBe(true);

    // What Back does: the sign-in entry is popped, leaving the setup one.
    window.history.replaceState({ sbSetup: true }, '');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.queryByTestId('onboarding-signin')).toBeNull();
    expect(screen.getByTestId('onboarding-intro')).toBeTruthy();
  });

  it('a successful sign-in exits onboarding with the account targets', async () => {
    const { onDone } = renderWith(async () => ({ targets: TARGETS, connected: true }));
    fireEvent.click(screen.getByTestId('signin-link'));
    await screen.findByRole('link', { name: 'Continue with Google' });
    expect(onDone).not.toHaveBeenCalled();

    // Sign-in completes elsewhere (another tab / the Google round trip)...
    signedIn = true;
    // ...and the app notices when it is looked at again.
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(TARGETS));
    expect(localStorage.getItem('snapbite.onboarding.resume')).toBeNull();
  });

  it('continues to the key step when the account has targets but no key yet', async () => {
    const { onDone } = renderWith(async () => ({ targets: TARGETS, connected: false }));
    fireEvent.click(screen.getByTestId('signin-link'));
    await screen.findByRole('link', { name: 'Continue with Google' });

    signedIn = true;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(screen.getAllByText(/Add your AI key/i).length).toBeGreaterThan(0));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('goes straight to the form when a new account has no goal yet: no welcome, no toast', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const onToast = vi.fn();
    const { onDone } = renderWith(async () => ({ targets: null, connected: true }), { onToast });
    fireEvent.click(screen.getByTestId('signin-link'));
    await screen.findByRole('link', { name: 'Continue with Google' });

    signedIn = true;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(screen.queryByTestId('onboarding-signin')).toBeNull());
    expect(await screen.findByTestId('onboarding-form')).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' });
    expect(screen.getByText('Signed in as ada@example.com')).toBeTruthy();
    expect(document.activeElement).toBe(document.querySelector('input[type=date]'));
    expect(onToast).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('OnboardingScreen for an account that is already signed in', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    setReduced(false);
  });
  afterEach(() => {
    restore();
  });

  const mount = (account: { email: string | null } | null = { email: 'ada@example.com' }) => {
    const { backend } = makeBackend();
    render(
      <OnboardingScreen backend={backend} account={account} onDone={vi.fn()} onSkip={vi.fn()} />,
    );
  };

  it('opens on the form alone: no welcome, no intro, no scroll hint, no skeleton', () => {
    mount();
    // Synchronously, on first render: nothing to wait for or animate into.
    expect(screen.getByTestId('onboarding-form')).toBeTruthy();
    expect(document.querySelector('input[type=date]')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-intro')).toBeNull();
    expect(screen.queryByRole('heading', { name: /welcome/i })).toBeNull();
    expect(screen.queryByTestId('scroll-cue')).toBeNull();
    expect(screen.queryByTestId('onboarding-skeleton')).toBeNull();
    expect(screen.queryByTestId('signin-link')).toBeNull();
  });

  it('says who they are signed in as, and puts the cursor in the first empty field', () => {
    mount();
    expect(screen.getByText('Signed in as ada@example.com')).toBeTruthy();
    expect(document.activeElement).toBe(document.querySelector('input[type=date]'));
  });

  it('does not start a one-second timer for a cue that is not there', () => {
    vi.useFakeTimers();
    try {
      mount();
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.queryByTestId('scroll-cue')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('an anonymous visitor still gets the welcome, then the form below it', () => {
    mount(null);
    expect(screen.getByTestId('onboarding-intro')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-form')).toBeNull();
  });

  it('can still be skipped', () => {
    const onSkip = vi.fn();
    const { backend } = makeBackend();
    render(
      <OnboardingScreen
        backend={backend}
        account={{ email: null }}
        onDone={vi.fn()}
        onSkip={onSkip}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(onSkip).toHaveBeenCalled();
  });
});
