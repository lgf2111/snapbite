import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
