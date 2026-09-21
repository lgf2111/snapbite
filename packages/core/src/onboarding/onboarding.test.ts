import { describe, expect, it } from 'vitest';
import { computeTargets } from '../profile/profile.js';
import {
  applyAnswer,
  buildProfile,
  ONBOARDING_STEPS,
  type OnboardingState,
  promptFor,
  startOnboarding,
} from './onboarding.js';

describe('startOnboarding', () => {
  it('begins at the sex step with a prompt', () => {
    const { state, prompt } = startOnboarding();
    expect(state.step).toBe('sex');
    expect(state.partial).toEqual({});
    expect(prompt.toLowerCase()).toContain('male');
  });
});

describe('promptFor', () => {
  it('has a prompt for every step', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(promptFor(step).length).toBeGreaterThan(0);
    }
  });
});

describe('applyAnswer — parsing + advancement', () => {
  it('rejects a bad sex answer and keeps the step', () => {
    const r = applyAnswer({ step: 'sex', partial: {} }, 'yes');
    expect(r.ok).toBe(false);
  });

  it('accepts m/f shorthands and advances to birthday', () => {
    const r = applyAnswer({ step: 'sex', partial: {} }, 'm');
    expect(r).toMatchObject({ ok: true, done: false });
    if (r.ok && !r.done) {
      expect(r.state.step).toBe('birthday');
      expect(r.state.partial.sex).toBe('male');
    }
  });

  it('accepts a birthday and derives a sane age; rejects bad dates', () => {
    const ok = applyAnswer({ step: 'birthday', partial: { sex: 'male' } }, '1998-04-25');
    expect(ok.ok).toBe(true);
    if (ok.ok && !ok.done) expect(ok.state.partial.birthDate).toBe('1998-04-25');
    expect(applyAnswer({ step: 'birthday', partial: {} }, 'not a date').ok).toBe(false);
    // A birth date implying age < 13 is rejected.
    const thisYear = new Date().getFullYear();
    expect(applyAnswer({ step: 'birthday', partial: {} }, `${thisYear - 5}-01-01`).ok).toBe(false);
  });

  it('parses height in cm, meters, and feet/inches', () => {
    const cm = applyAnswer({ step: 'height', partial: {} }, '175cm');
    const m = applyAnswer({ step: 'height', partial: {} }, '1.75m');
    const ft = applyAnswer({ step: 'height', partial: {} }, "5'9");
    for (const r of [cm, m, ft]) expect(r.ok).toBe(true);
    if (cm.ok && !cm.done) expect(cm.state.partial.heightCm).toBeCloseTo(175, 0);
    if (m.ok && !m.done) expect(m.state.partial.heightCm).toBeCloseTo(175, 0);
    if (ft.ok && !ft.done) expect(ft.state.partial.heightCm).toBeGreaterThan(170);
  });

  it('parses weight in kg and lb', () => {
    const kg = applyAnswer({ step: 'weight', partial: {} }, '70kg');
    const lb = applyAnswer({ step: 'weight', partial: {} }, '155lb');
    expect(kg.ok && !kg.done && Math.round(kg.state.partial.weightKg!)).toBe(70);
    expect(lb.ok && !lb.done && Math.round(lb.state.partial.weightKg!)).toBe(70); // 155lb ≈ 70.3kg
  });

  it('parses activity by number and advances to goal', () => {
    const a = applyAnswer({ step: 'activity', partial: {} }, '3');
    expect(a.ok && !a.done && a.state.partial.activity).toBe('moderate');
    if (a.ok && !a.done) expect(a.state.step).toBe('goal');
  });

  it('rejects an out-of-range activity/goal number', () => {
    expect(applyAnswer({ step: 'activity', partial: {} }, '9').ok).toBe(false);
    expect(applyAnswer({ step: 'goal', partial: {} }, '0').ok).toBe(false);
  });
});

describe('full flow → complete profile + targets', () => {
  it('runs all steps and produces a valid profile', () => {
    let state: OnboardingState = startOnboarding().state;
    const answers = ['female', '1994-06-15', '165cm', '60kg', '2']; // through activity
    for (const ans of answers) {
      const r = applyAnswer(state, ans);
      expect(r.ok).toBe(true);
      if (r.ok && !r.done) state = r.state;
    }
    // Final step: goal.
    const final = applyAnswer(state, '3'); // maintain
    expect(final).toMatchObject({ ok: true, done: true });
    if (final.ok && final.done) {
      expect(final.profile.sex).toBe('female');
      expect(final.profile.birthDate).toBe('1994-06-15');
      expect(final.profile.goal).toBe('maintain');
      // computeTargets works on the built profile.
      const t = computeTargets(final.profile);
      expect(t.energyKcal).toBeGreaterThan(1000);
      expect(t.proteinG).toBeGreaterThan(0);
    }
  });
});

describe('buildProfile', () => {
  it('returns null on an incomplete partial', () => {
    expect(buildProfile({ sex: 'male', birthDate: '1998-04-25' })).toBeNull();
  });
  it('builds a metric profile with birthDate from a complete partial', () => {
    const p = buildProfile({
      sex: 'male',
      birthDate: '1998-04-25',
      heightCm: 180,
      weightKg: 75,
      activity: 'light',
      goal: 'lose_steady',
    });
    expect(p?.units).toBe('metric');
    expect(p?.goal).toBe('lose_steady');
    expect(p?.birthDate).toBe('1998-04-25');
  });
});
