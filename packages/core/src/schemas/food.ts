import { z } from 'zod';

/**
 * A confidence score in [0, 1]. Used both per-food and for the overall analysis.
 */
export const Confidence = z.number().min(0).max(1);
export type Confidence = z.infer<typeof Confidence>;

/**
 * A single food the AI identified in a photo, before nutrition is resolved.
 * Portion is a free-text human description ("1 bowl", "2 slices"); the numeric
 * `estimatedWeightG` is what the nutrition resolver actually scales by.
 */
export const FoodItem = z.object({
  name: z.string().min(1),
  estimatedWeightG: z.number().finite().positive(),
  portion: z.string().min(1).optional(),
  quantity: z.number().finite().positive().default(1),
  confidence: Confidence,
});
export type FoodItem = z.infer<typeof FoodItem>;
