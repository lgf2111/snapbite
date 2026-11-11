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

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe('OnboardingScreen resume', () => {
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
    for (const id of ['onboarding-intro', 'onboarding-form-panel']) {
      const panel = screen.getByTestId(id);
      expect(panel.className).toContain('h-[100svh]');
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
