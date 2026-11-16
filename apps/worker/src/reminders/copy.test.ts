import { describe, expect, it } from 'vitest';
import {
  DINNER_LINES,
  FOOD_WORDS,
  LUNCH_LINES,
  SHARED_LINES,
  STREAK_LINES,
  pickReminderCopy,
} from './copy.js';

const DAY = 24 * 60 * 60 * 1000;
const EMOJI =
  /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|\p{Regional_Indicator}{1,2}|\u20E3)/u;

/** 2026-06-01 plus `days`, the same base the reminder integration tests use. */
function dateKey(days = 0): string {
  return new Date(Date.UTC(2026, 5, 1) + days * DAY).toISOString().slice(0, 10);
}

describe('pickReminderCopy', () => {
  it('is stable for the same inputs, so a retry sends the same words', () => {
    const input = { slot: 'lunch', dateKey: dateKey(3), userId: 'user-a', streak: 4 };
    expect(pickReminderCopy(input)).toEqual(pickReminderCopy(input));
    expect(pickReminderCopy(input).body).toBe(pickReminderCopy(input).body);
  });

  it('gives eight consecutive days eight different bodies', () => {
    const bodies = Array.from(
      { length: 8 },
      (_, day) => pickReminderCopy({ slot: 'lunch', dateKey: dateKey(day), userId: 'user-a' }).body,
    );
    expect(new Set(bodies).size).toBe(8);
  });

  it('does not give two users the identical message on the same day', () => {
    const a = pickReminderCopy({ slot: 'dinner', dateKey: dateKey(5), userId: 'user-a' });
    const b = pickReminderCopy({ slot: 'dinner', dateKey: dateKey(5), userId: 'user-b' });
    expect(a.body).not.toBe(b.body);
  });

  it('uses the streak pool at 2+, and the plain pool below or when unknown', () => {
    const day = dateKey(6);
    for (const streak of [2, 3, 6, 30]) {
      const { body } = pickReminderCopy({ slot: 'lunch', dateKey: day, userId: 'user-a', streak });
      expect(body).toContain(`Day ${streak}.`);
    }
    for (const streak of [undefined, 0, 1]) {
      const { body } = pickReminderCopy({ slot: 'lunch', dateKey: day, userId: 'user-a', streak });
      expect(body).not.toContain('Day ');
    }
  });

  it('keeps the title stable and plain', () => {
    expect(pickReminderCopy({ slot: 'lunch', dateKey: dateKey(), userId: 'u' }).title).toBe(
      'Lunch',
    );
    expect(pickReminderCopy({ slot: 'dinner', dateKey: dateKey(), userId: 'u' }).title).toBe(
      'Dinner',
    );
    for (const title of ['Lunch', 'Dinner']) {
      expect(title).not.toMatch(/[!]/);
      expect(title).not.toMatch(EMOJI);
    }
  });

  it('keeps every generated body within 120 characters and free of emoji or em dashes', () => {
    for (const slot of ['lunch', 'dinner', 'breakfast', 'tea break']) {
      for (let day = 0; day < 60; day += 1) {
        for (const userId of ['user-a', 'user-b', 'user-c']) {
          for (const streak of [undefined, 0, 1, 2, 6, 30, 120]) {
            const { body } = pickReminderCopy({ slot, dateKey: dateKey(day), userId, streak });
            expect(body.length).toBeLessThanOrEqual(120);
            expect(body).not.toContain('\u2014');
            expect(body).not.toMatch(EMOJI);
          }
        }
      }
    }
  });

  it('adds a food word on roughly every third day', () => {
    const bodies = Array.from(
      { length: 30 },
      (_, day) => pickReminderCopy({ slot: 'lunch', dateKey: dateKey(day), userId: 'user-a' }).body,
    );
    const wordDays = bodies.filter((body) => FOOD_WORDS.some((word) => body.includes(word)));
    expect(wordDays.length).toBeGreaterThanOrEqual(7);
    expect(wordDays.length).toBeLessThanOrEqual(13);
  });

  it('has enough lines per pool for more than a week without a repeat', () => {
    expect(LUNCH_LINES.length).toBeGreaterThanOrEqual(8);
    expect(DINNER_LINES.length).toBeGreaterThanOrEqual(8);
    expect(SHARED_LINES.length).toBeGreaterThanOrEqual(8);
    expect(STREAK_LINES.length).toBeGreaterThanOrEqual(8);
    expect(FOOD_WORDS.length).toBeGreaterThan(0);
  });
});
