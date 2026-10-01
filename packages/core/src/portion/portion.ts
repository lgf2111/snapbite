/**
 * Deterministic portion rescaling + the inline "one-tap portion" keyboard.
 *
 * The documented weak point of AI calorie estimates is portion sizing. Rather
 * than claim false precision, SnapBite surfaces low confidence and offers the
 * user instant multipliers (¼ · ½ · 1× · 2×) that rescale a just-logged meal's
 * macros by pure arithmetic — no AI re-call, no new weight. All values stay
 * editable estimates.
 */

import type { MealResult } from '../schemas/meal.js';
import type { NutritionValue } from '../schemas/nutrition.js';
import type { BotReply, InlineKeyboardButton } from '../telegram/bot.js';

/** Below this overall confidence, offer the one-tap portion buttons. */
export const LOW_CONFIDENCE_THRESHOLD = 0.75;

/** The portion multipliers offered, in display order. */
export const PORTION_FACTORS = [0.25, 0.5, 1, 2] as const;
export type PortionFactor = (typeof PORTION_FACTORS)[number];

/** Prefix for a portion-rescale callback (`rsz:<factor>`). Kept short (Telegram caps callback_data at 64 bytes). */
export const RESCALE_CALLBACK_PREFIX = 'rsz';

/** Human label for a portion factor button (¼ · ½ · 1× · 2×). */
export function portionLabel(factor: number): string {
  if (factor === 0.25) return '¼×';
  if (factor === 0.5) return '½×';
  if (factor === 0.75) return '¾×';
  if (factor === 1) return '1×';
  // Whole numbers read better without a trailing ".0".
  const n = Number.isInteger(factor) ? String(factor) : String(round1(factor));
  return `${n}×`;
}

/** The callback_data string for a portion button. */
export function rescaleCallbackData(factor: number): string {
  return `${RESCALE_CALLBACK_PREFIX}:${factor}`;
}

/**
 * Parses a portion-rescale callback_data (`rsz:<factor>`) into a positive,
 * finite factor, or null when it isn't a rescale callback / isn't valid. The
 * factor is bounded to a sane range so a crafted payload can't blow up a meal.
 */
export function parseRescaleCallback(data: string | null | undefined): number | null {
  if (!data) return null;
  const [prefix, raw] = data.split(':');
  if (prefix !== RESCALE_CALLBACK_PREFIX || raw == null) return null;
  const factor = Number(raw);
  if (!Number.isFinite(factor) || factor <= 0 || factor > 10) return null;
  return factor;
}

/** Whether a just-logged meal is uncertain enough to offer portion correction. */
export function isLowConfidence(confidence: number | null | undefined): boolean {
  return typeof confidence === 'number' && Number.isFinite(confidence)
    ? confidence < LOW_CONFIDENCE_THRESHOLD
    : false;
}

/**
 * The inline keyboard row of portion multipliers. The current factor (if known)
 * is marked so the user sees which scaling is active. `1×` always appears so a
 * user can snap back to the original estimate.
 */
export function portionKeyboardRow(currentFactor?: number): InlineKeyboardButton[] {
  return PORTION_FACTORS.map((f) => {
    const active = currentFactor != null && approxEq(f, currentFactor);
    return {
      text: active ? `✅ ${portionLabel(f)}` : portionLabel(f),
      callback_data: rescaleCallbackData(f),
    };
  });
}

/** Multiplies every macro/energy value in a nutrition record by `factor`. */
function scaleNutrition(n: NutritionValue, factor: number): NutritionValue {
  return {
    energyKcal: round1(n.energyKcal * factor),
    proteinG: round1(n.proteinG * factor),
    carbsG: round1(n.carbsG * factor),
    fatG: round1(n.fatG * factor),
    ...(n.fiberG != null ? { fiberG: round1(n.fiberG * factor) } : {}),
    source: n.source,
  };
}

/**
 * Deterministically rescales a meal by `factor`: every food's resolved
 * nutrition and the meal total are multiplied, and each food's `quantity` is
 * scaled too (so the portion stays coherent if the meal is later revised).
 * Confidence is unchanged — the user is correcting the estimate, not the
 * model's certainty. No AI, no network. Returns a NEW MealResult.
 */
export function rescaleMeal(meal: MealResult, factor: number): MealResult {
  if (!(factor > 0) || !Number.isFinite(factor)) return meal;
  return {
    ...meal,
    foods: meal.foods.map((mf) => ({
      food: { ...mf.food, quantity: round2(mf.food.quantity * factor) },
      nutrition: scaleNutrition(mf.nutrition, factor),
    })),
    total: scaleNutrition(meal.total, factor),
  };
}

/** A short note recorded on a rescaled meal so the change is visible/auditable. */
export function rescaleNote(factor: number): string {
  return `Portion adjusted to ${portionLabel(factor)}.`;
}

function approxEq(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/** Rounds to one decimal for display/storage of macros. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Rounds to two decimals (quantities can be fractional, e.g. 0.25). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Appends the portion-multiplier keyboard row to an existing reply's inline
 * keyboard (e.g. the "Open SnapBite" launch button), returning a NEW reply.
 * Used so a low-confidence log confirmation carries both buttons.
 */
export function withPortionButtons(reply: BotReply, currentFactor?: number): BotReply {
  const existing = reply.replyMarkup?.inline_keyboard ?? [];
  return {
    ...reply,
    replyMarkup: { inline_keyboard: [portionKeyboardRow(currentFactor), ...existing] },
  };
}
