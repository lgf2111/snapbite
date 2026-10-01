import { describe, expect, it } from 'vitest';
import type { MealResult } from '../schemas/meal.js';
import type { BotReply } from '../telegram/bot.js';
import {
  LOW_CONFIDENCE_THRESHOLD,
  isLowConfidence,
  parseRescaleCallback,
  portionKeyboardRow,
  portionLabel,
  rescaleCallbackData,
  rescaleMeal,
  rescaleNote,
  withPortionButtons,
} from './portion.js';

const meal: MealResult = {
  foods: [
    {
      food: { name: 'rice', estimatedWeightG: 200, quantity: 1, confidence: 0.6 },
      nutrition: { energyKcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, source: 'table' },
    },
    {
      food: { name: 'curry', estimatedWeightG: 180, quantity: 1, confidence: 0.6 },
      nutrition: {
        energyKcal: 270,
        proteinG: 21.6,
        carbsG: 10.8,
        fatG: 16.2,
        fiberG: 3,
        source: 'ai_estimate',
      },
    },
  ],
  total: {
    energyKcal: 530,
    proteinG: 27,
    carbsG: 66.8,
    fatG: 16.8,
    fiberG: 3,
    source: 'mixed',
  },
  confidence: 0.6,
  needsConfirmation: false,
};

describe('isLowConfidence', () => {
  it('is true just below the threshold and false at/above it', () => {
    expect(isLowConfidence(LOW_CONFIDENCE_THRESHOLD - 0.01)).toBe(true);
    expect(isLowConfidence(LOW_CONFIDENCE_THRESHOLD)).toBe(false);
    expect(isLowConfidence(0.9)).toBe(false);
  });

  it('is false for missing/invalid confidence', () => {
    expect(isLowConfidence(null)).toBe(false);
    expect(isLowConfidence(undefined)).toBe(false);
    expect(isLowConfidence(Number.NaN)).toBe(false);
  });
});

describe('portionLabel', () => {
  it('renders the fraction glyphs and whole multipliers', () => {
    expect(portionLabel(0.25)).toBe('¼×');
    expect(portionLabel(0.5)).toBe('½×');
    expect(portionLabel(1)).toBe('1×');
    expect(portionLabel(2)).toBe('2×');
  });
});

describe('rescaleCallbackData / parseRescaleCallback', () => {
  it('round-trips a factor', () => {
    expect(parseRescaleCallback(rescaleCallbackData(0.5))).toBe(0.5);
    expect(parseRescaleCallback(rescaleCallbackData(2))).toBe(2);
  });

  it('rejects non-rescale, malformed, or out-of-range payloads', () => {
    expect(parseRescaleCallback(null)).toBeNull();
    expect(parseRescaleCallback('')).toBeNull();
    expect(parseRescaleCallback('other:0.5')).toBeNull();
    expect(parseRescaleCallback('rsz:abc')).toBeNull();
    expect(parseRescaleCallback('rsz:0')).toBeNull();
    expect(parseRescaleCallback('rsz:-1')).toBeNull();
    expect(parseRescaleCallback('rsz:999')).toBeNull();
  });
});

describe('rescaleMeal', () => {
  it('scales every food + total by the factor (half)', () => {
    const half = rescaleMeal(meal, 0.5);
    expect(half.total.energyKcal).toBe(265);
    expect(half.total.proteinG).toBe(13.5);
    expect(half.total.fiberG).toBe(1.5);
    expect(half.foods[0]?.nutrition.energyKcal).toBe(130);
    expect(half.foods[1]?.nutrition.fiberG).toBe(1.5);
    // Quantities scale too, so a later revise stays coherent.
    expect(half.foods[0]?.food.quantity).toBe(0.5);
  });

  it('scales up by a whole factor', () => {
    const dbl = rescaleMeal(meal, 2);
    expect(dbl.total.energyKcal).toBe(1060);
    expect(dbl.foods[1]?.nutrition.proteinG).toBe(43.2);
    expect(dbl.foods[0]?.food.quantity).toBe(2);
  });

  it('preserves source labels and confidence (the user corrects portion, not certainty)', () => {
    const r = rescaleMeal(meal, 0.25);
    expect(r.total.source).toBe('mixed');
    expect(r.foods[0]?.nutrition.source).toBe('table');
    expect(r.confidence).toBe(meal.confidence);
  });

  it('omits fiber on foods that never had it', () => {
    const r = rescaleMeal(meal, 2);
    expect(r.foods[0]?.nutrition.fiberG).toBeUndefined();
  });

  it('returns the meal unchanged for an invalid factor', () => {
    expect(rescaleMeal(meal, 0)).toBe(meal);
    expect(rescaleMeal(meal, Number.NaN)).toBe(meal);
  });
});

describe('portionKeyboardRow', () => {
  it('offers the four multipliers with callback_data', () => {
    const row = portionKeyboardRow();
    expect(row).toHaveLength(4);
    expect(row.map((b) => b.callback_data)).toEqual(['rsz:0.25', 'rsz:0.5', 'rsz:1', 'rsz:2']);
  });

  it('marks the active factor', () => {
    const row = portionKeyboardRow(0.5);
    expect(row[1]?.text.startsWith('✅')).toBe(true);
    expect(row[0]?.text.startsWith('✅')).toBe(false);
  });
});

describe('withPortionButtons', () => {
  it('prepends the portion row above an existing keyboard', () => {
    const base: BotReply = {
      text: 'Logged',
      replyMarkup: { inline_keyboard: [[{ text: 'Open', web_app: { url: 'https://x' } }]] },
    };
    const out = withPortionButtons(base);
    expect(out.replyMarkup?.inline_keyboard).toHaveLength(2);
    expect(out.replyMarkup?.inline_keyboard[0]).toHaveLength(4);
    expect(out.replyMarkup?.inline_keyboard[1]?.[0]?.web_app?.url).toBe('https://x');
    expect(out.text).toBe('Logged');
  });

  it('works when there is no existing keyboard', () => {
    const out = withPortionButtons({ text: 'Logged' });
    expect(out.replyMarkup?.inline_keyboard).toHaveLength(1);
  });
});

describe('rescaleNote', () => {
  it('describes the applied factor', () => {
    expect(rescaleNote(0.5)).toBe('Portion adjusted to ½×.');
  });
});
