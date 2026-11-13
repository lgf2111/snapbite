import { Beef, Droplet, type LucideIcon, Sprout, Wheat } from 'lucide-react';

export type MacroKey = 'protein' | 'carbs' | 'fat' | 'fiber';

/**
 * One glyph per macro, in one place so the inline values and the Home bars
 * cannot drift:
 *
 *   protein = Beef
 *   carbs   = Wheat
 *   fat     = Droplet
 *   fiber   = Sprout
 *
 * kcal deliberately has no icon (the word "kcal" always sits beside the
 * number), and the streak's Flame is never reused for a macro.
 */
export const MACRO_ICONS: Record<MacroKey, LucideIcon> = {
  protein: Beef,
  carbs: Wheat,
  fat: Droplet,
  fiber: Sprout,
};

/** The macro's name, used as the screen-reader label beside its icon. */
export const MACRO_LABELS: Record<MacroKey, string> = {
  protein: 'Protein',
  carbs: 'Carbs',
  fat: 'Fat',
  fiber: 'Fiber',
};
