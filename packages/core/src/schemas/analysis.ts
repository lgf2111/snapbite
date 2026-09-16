import { z } from 'zod';
import { Confidence, FoodItem } from './food.js';

/**
 * The structured result the AIProvider returns from analyzing a meal photo.
 * This is the raw, pre-nutrition output: foods + portions come first, nutrition
 * is resolved afterward (never asked of the AI directly).
 */
export const AIFoodAnalysis = z.object({
  foods: z.array(FoodItem).min(1),
  confidence: Confidence,
  needsConfirmation: z.boolean(),
  notes: z.string().optional(),
});
export type AIFoodAnalysis = z.infer<typeof AIFoodAnalysis>;
