import { describe, expect, it } from 'vitest';
import {
  dueReminderSlots,
  localParts,
  parseHhMm,
  REMINDER_STEP_MINUTES,
  reminderMessage,
  snapToReminderStep,
} from './reminders.js';

describe('parseHhMm', () => {
  it('parses valid times', () => {
    expect(parseHhMm('08:00')).toBe(480);
    expect(parseHhMm('12:30')).toBe(750);
    expect(parseHhMm('23:59')).toBe(1439);
  });
  it('rejects malformed values', () => {
    expect(parseHhMm('nope')).toBeNull();
    expect(parseHhMm('24:00')).toBeNull();
    expect(parseHhMm('10:60')).toBeNull();
  });
});

describe('snapToReminderStep', () => {
  it('uses a 15-minute grid', () => {
    expect(REMINDER_STEP_MINUTES).toBe(15);
  });
  it('leaves on-grid times unchanged', () => {
    expect(snapToReminderStep('08:00')).toBe('08:00');
    expect(snapToReminderStep('12:30')).toBe('12:30');
    expect(snapToReminderStep('19:45')).toBe('19:45');
  });
  it('rounds off-grid times to the nearest slot', () => {
    expect(snapToReminderStep('08:07')).toBe('08:00'); // down
    expect(snapToReminderStep('08:08')).toBe('08:15'); // up
    expect(snapToReminderStep('08:52')).toBe('08:45'); // down within hour
    expect(snapToReminderStep('08:53')).toBe('09:00'); // rolls into next hour
  });
  it('clamps a round-up near midnight to 23:45 (stays same day)', () => {
    expect(snapToReminderStep('23:53')).toBe('23:45');
  });
  it('returns malformed input unchanged', () => {
    expect(snapToReminderStep('nope')).toBe('nope');
  });
});

describe('localParts', () => {
  it('shifts UTC to local using the offset (UTC+8 => offset -480)', () => {
    // 2026-01-01T00:30:00Z, offset -480 (UTC+8) => local 08:30 same wall date.
    const utc = Date.UTC(2026, 0, 1, 0, 30);
    const { dateKey, minutesOfDay } = localParts(utc, -480);
    expect(dateKey).toBe('2026-01-01');
    expect(minutesOfDay).toBe(8 * 60 + 30);
  });
});

describe('dueReminderSlots', () => {
  const base = {
    enabled: true,
    times: { breakfast: '08:00', dinner: '19:00' },
    tzOffsetMinutes: 0, // treat nowMs as local for simplicity
  };

  it('returns a slot when the current local minute is within the window', () => {
    // 08:05 UTC, offset 0 => local 08:05, within [08:00, 08:15).
    const now = Date.UTC(2026, 0, 1, 8, 5);
    expect(dueReminderSlots(base, now, 15)).toEqual(['breakfast']);
  });

  it('returns nothing outside the window', () => {
    const now = Date.UTC(2026, 0, 1, 8, 20); // past the 15-min window
    expect(dueReminderSlots(base, now, 15)).toEqual([]);
  });

  it('skips a slot already sent today (local)', () => {
    const now = Date.UTC(2026, 0, 1, 8, 5);
    const cfg = { ...base, lastSent: { breakfast: '2026-01-01' } };
    expect(dueReminderSlots(cfg, now, 15)).toEqual([]);
  });

  it('returns nothing when disabled', () => {
    const now = Date.UTC(2026, 0, 1, 8, 5);
    expect(dueReminderSlots({ ...base, enabled: false }, now, 15)).toEqual([]);
  });
});

describe('reminderMessage', () => {
  it('has tailored copy for known slots and a fallback for custom', () => {
    expect(reminderMessage('breakfast').toLowerCase()).toContain('breakfast');
    expect(reminderMessage('supper')).toContain('supper');
  });
});
