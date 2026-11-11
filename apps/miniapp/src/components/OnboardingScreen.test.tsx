import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../lib/backend.js';
import { OnboardingScreen } from './OnboardingScreen.js';

/**
 * The bug this pins: finishing step 1 saved the profile server-side, but the
 * client forgot it had reached step 2, so a reload started the whole form again.
 */

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

describe('OnboardingScreen resume', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('opens at the key step when the profile is already saved', () => {
    const { backend } = makeBackend();
    render(<OnboardingScreen backend={backend} startAtKeyStep onDone={vi.fn()} onSkip={vi.fn()} />);
    // The key step's heading, not the profile form's "Welcome".
    expect(screen.getByText(/Add your AI key/i)).toBeTruthy();
  });

  it('records the key step so a reload resumes there', async () => {
    const { backend, saveProfile } = makeBackend();
    render(<OnboardingScreen backend={backend} onDone={vi.fn()} onSkip={vi.fn()} />);

    // Fill the profile form and advance.
    const dob = document.querySelector('input[type=date]') as HTMLInputElement;
    fireEvent.change(dob, { target: { value: '1990-05-05' } });
    const next = screen
      .getAllByRole('button')
      .find((b) => /set my goal/i.test(b.textContent ?? ''));
    expect(next).toBeTruthy();
    fireEvent.click(next as HTMLButtonElement);

    await waitFor(() => expect(saveProfile).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(/Add your AI key/i).length).toBeGreaterThan(0));

    const saved = JSON.parse(localStorage.getItem('snapbite.onboarding.resume') ?? '{}');
    expect(saved.step).toBe('apikey');
    // The credential itself must never be persisted.
    expect(JSON.stringify(saved)).not.toMatch(/apiKey|AIza/);
  });

  it('clears the resume record once onboarding finishes', async () => {
    const { backend } = makeBackend();
    const onSkip = vi.fn();
    render(<OnboardingScreen backend={backend} startAtKeyStep onDone={vi.fn()} onSkip={onSkip} />);

    const skip = screen
      .getAllByRole('button')
      .find((b) => /track meals manually/i.test(b.textContent ?? ''));
    fireEvent.click(skip as HTMLButtonElement);

    await waitFor(() => expect(onSkip).toHaveBeenCalled());
    expect(localStorage.getItem('snapbite.onboarding.resume')).toBeNull();
  });
});

describe('OnboardingScreen intro', () => {
  const matchMedia = window.matchMedia;
  const setReduced = (reduced: boolean) => {
    window.matchMedia = ((q: string) => ({
      matches: reduced && q.includes('reduce'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
  };

  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    window.matchMedia = matchMedia;
  });

  it('shows the welcome first, then lets the form in after a second', () => {
    setReduced(false);
    const { backend } = makeBackend();
    render(<OnboardingScreen backend={backend} onDone={vi.fn()} onSkip={vi.fn()} />);

    expect(screen.getByTestId('onboarding-intro')).toBeTruthy();
    expect(screen.getByTestId('onboarding-form').hasAttribute('inert')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.getByTestId('onboarding-form').hasAttribute('inert')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('onboarding-form').hasAttribute('inert')).toBe(false);
  });

  it('keeps the welcome on screen and scrolls to the form when the gate opens', () => {
    setReduced(false);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { backend } = makeBackend();
    render(<OnboardingScreen backend={backend} onDone={vi.fn()} onSkip={vi.fn()} />);

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(scrollIntoView).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    // The welcome is the first screenful, not a transition that disappears.
    expect(screen.getByTestId('onboarding-intro')).toBeTruthy();
  });

  it('skips the intro and the wait under reduced motion', () => {
    setReduced(true);
    const { backend } = makeBackend();
    render(<OnboardingScreen backend={backend} onDone={vi.fn()} onSkip={vi.fn()} />);

    expect(screen.queryByTestId('onboarding-intro')).toBeNull();
    expect(screen.getByTestId('onboarding-form').hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('heading', { name: /welcome to snapbite/i })).toBeTruthy();
  });

  it('does not replay the intro when resuming at the key step', () => {
    setReduced(false);
    const { backend } = makeBackend();
    render(<OnboardingScreen backend={backend} startAtKeyStep onDone={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.queryByTestId('onboarding-intro')).toBeNull();
  });
});
