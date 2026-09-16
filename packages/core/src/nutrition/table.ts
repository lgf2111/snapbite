import type { NutritionPer100g } from '../schemas/food.js';

/**
 * A bundled, deterministic per-100g nutrition table for common foods. Values
 * are rounded, approximate, and meant as sensible defaults — every resolved
 * value is still surfaced to the user as an estimate and is correctable.
 *
 * Keys are normalized names (see {@link normalizeName}). This is intentionally
 * small; it grows over time. A miss simply falls back to the AI estimate.
 */
export const NUTRITION_TABLE: Readonly<Record<string, NutritionPer100g>> = {
  // Grains & starches
  'white rice': { energyKcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 },
  'brown rice': { energyKcal: 123, proteinG: 2.7, carbsG: 26, fatG: 1 },
  rice: { energyKcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 },
  bread: { energyKcal: 265, proteinG: 9, carbsG: 49, fatG: 3.2 },
  'white bread': { energyKcal: 265, proteinG: 9, carbsG: 49, fatG: 3.2 },
  pasta: { energyKcal: 131, proteinG: 5, carbsG: 25, fatG: 1.1 },
  spaghetti: { energyKcal: 131, proteinG: 5, carbsG: 25, fatG: 1.1 },
  noodles: { energyKcal: 138, proteinG: 4.5, carbsG: 25, fatG: 2.1 },
  potato: { energyKcal: 77, proteinG: 2, carbsG: 17, fatG: 0.1 },
  'french fries': { energyKcal: 312, proteinG: 3.4, carbsG: 41, fatG: 15 },
  oats: { energyKcal: 389, proteinG: 17, carbsG: 66, fatG: 7 },

  // Proteins
  'chicken breast': { energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 },
  chicken: { energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 },
  beef: { energyKcal: 250, proteinG: 26, carbsG: 0, fatG: 15 },
  pork: { energyKcal: 242, proteinG: 27, carbsG: 0, fatG: 14 },
  salmon: { energyKcal: 208, proteinG: 20, carbsG: 0, fatG: 13 },
  tuna: { energyKcal: 132, proteinG: 28, carbsG: 0, fatG: 1 },
  shrimp: { energyKcal: 99, proteinG: 24, carbsG: 0.2, fatG: 0.3 },
  egg: { energyKcal: 155, proteinG: 13, carbsG: 1.1, fatG: 11 },
  tofu: { energyKcal: 76, proteinG: 8, carbsG: 1.9, fatG: 4.8 },

  // Dairy
  milk: { energyKcal: 42, proteinG: 3.4, carbsG: 5, fatG: 1 },
  cheese: { energyKcal: 402, proteinG: 25, carbsG: 1.3, fatG: 33 },
  'greek yogurt': { energyKcal: 59, proteinG: 10, carbsG: 3.6, fatG: 0.4 },
  yogurt: { energyKcal: 61, proteinG: 3.5, carbsG: 4.7, fatG: 3.3 },

  // Vegetables
  broccoli: { energyKcal: 34, proteinG: 2.8, carbsG: 7, fatG: 0.4 },
  carrot: { energyKcal: 41, proteinG: 0.9, carbsG: 10, fatG: 0.2 },
  spinach: { energyKcal: 23, proteinG: 2.9, carbsG: 3.6, fatG: 0.4 },
  tomato: { energyKcal: 18, proteinG: 0.9, carbsG: 3.9, fatG: 0.2 },
  lettuce: { energyKcal: 15, proteinG: 1.4, carbsG: 2.9, fatG: 0.2 },

  // Fruits
  apple: { energyKcal: 52, proteinG: 0.3, carbsG: 14, fatG: 0.2 },
  banana: { energyKcal: 89, proteinG: 1.1, carbsG: 23, fatG: 0.3 },
  orange: { energyKcal: 47, proteinG: 0.9, carbsG: 12, fatG: 0.1 },

  // Legumes & nuts
  'black beans': { energyKcal: 132, proteinG: 8.9, carbsG: 24, fatG: 0.5 },
  lentils: { energyKcal: 116, proteinG: 9, carbsG: 20, fatG: 0.4 },
  almonds: { energyKcal: 579, proteinG: 21, carbsG: 22, fatG: 50 },
  peanuts: { energyKcal: 567, proteinG: 26, carbsG: 16, fatG: 49 },

  // Fats & extras
  'olive oil': { energyKcal: 884, proteinG: 0, carbsG: 0, fatG: 100 },
  butter: { energyKcal: 717, proteinG: 0.9, carbsG: 0.1, fatG: 81 },
  avocado: { energyKcal: 160, proteinG: 2, carbsG: 9, fatG: 15 },
};

/**
 * Normalizes a food name for table lookup: lowercase, trimmed, collapsed
 * whitespace, and stripped of a leading article. Deterministic — no AI.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(a|an|the)\s+/, '');
}

/**
 * Looks up a food in the bundled table, returning its per-100g nutrition or
 * `undefined` on a miss. Tries the full normalized name first, then a couple of
 * simple relaxations (drop a trailing plural 's', match on the last word).
 */
export function lookupTable(name: string): NutritionPer100g | undefined {
  const norm = normalizeName(name);
  if (norm in NUTRITION_TABLE) return NUTRITION_TABLE[norm];

  // Try simple singular/plural relaxations in both directions.
  const plural = `${norm}s`;
  if (plural in NUTRITION_TABLE) return NUTRITION_TABLE[plural];

  const singular = norm.replace(/s$/, '');
  if (singular !== norm && singular in NUTRITION_TABLE) return NUTRITION_TABLE[singular];

  // Fall back to matching on the last word (e.g. "grilled chicken" -> "chicken").
  const lastWord = norm.split(' ').at(-1);
  if (lastWord && lastWord !== norm) {
    if (lastWord in NUTRITION_TABLE) return NUTRITION_TABLE[lastWord];
    const lastPlural = `${lastWord}s`;
    if (lastPlural in NUTRITION_TABLE) return NUTRITION_TABLE[lastPlural];
    const lastSingular = lastWord.replace(/s$/, '');
    if (lastSingular !== lastWord && lastSingular in NUTRITION_TABLE) {
      return NUTRITION_TABLE[lastSingular];
    }
  }

  return undefined;
}
