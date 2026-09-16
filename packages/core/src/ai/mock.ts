import type { AIFoodAnalysis } from '../schemas/analysis.js';
import type { AIProvider, AnalyzeMealOptions, MealImage } from './types.js';

/**
 * A deterministic {@link AIProvider} for local development, demos, and tests.
 * Returns a canned analysis without any network call. The default response
 * mixes a table-backed food (rice) with an AI-only food (curry) so downstream
 * nutrition resolution exercises the `mixed` source path.
 */
export class MockAIProvider implements AIProvider {
  readonly id = 'mock';
  readonly #response: AIFoodAnalysis;
  #lastImage: MealImage | undefined;

  constructor(response?: AIFoodAnalysis) {
    this.#response = response ?? DEFAULT_MOCK_ANALYSIS;
  }

  /** The image passed to the most recent `analyzeMeal` call, for assertions. */
  get lastImage(): MealImage | undefined {
    return this.#lastImage;
  }

  async analyzeMeal(image: MealImage, _opts?: AnalyzeMealOptions): Promise<AIFoodAnalysis> {
    this.#lastImage = image;
    // Return a fresh clone so callers can mutate without affecting the template.
    return structuredClone(this.#response);
  }
}

/** The canned analysis used when no custom response is provided. */
export const DEFAULT_MOCK_ANALYSIS: AIFoodAnalysis = {
  foods: [
    {
      name: 'white rice',
      estimatedWeightG: 200,
      portion: '1 bowl',
      quantity: 1,
      confidence: 0.9,
    },
    {
      name: 'chicken curry',
      estimatedWeightG: 180,
      portion: '1 serving',
      quantity: 1,
      confidence: 0.75,
      aiNutrition: { energyKcal: 150, proteinG: 12, carbsG: 6, fatG: 9 },
    },
  ],
  confidence: 0.82,
  needsConfirmation: false,
  notes: 'Mock analysis for local development.',
};
