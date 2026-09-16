import {
  type AIProvider,
  type MealImage,
  type MealResult,
  MockAIProvider,
  resolveMeal,
} from '@foodlog/core';

/**
 * A meal processor: takes an image and returns a resolved, editable MealResult.
 * Task 5 uses the mock; Task 8 swaps in a Worker-backed implementation behind
 * this same interface.
 */
export interface MealProcessor {
  analyze(image: MealImage, hint?: string): Promise<MealResult>;
}

/** Runs the shared core pipeline against a provider (mock by default). */
export class LocalMealProcessor implements MealProcessor {
  readonly #provider: AIProvider;

  constructor(provider: AIProvider = new MockAIProvider()) {
    this.#provider = provider;
  }

  async analyze(image: MealImage, hint?: string): Promise<MealResult> {
    const analysis = await this.#provider.analyzeMeal(image, hint ? { hint } : {});
    return resolveMeal(analysis);
  }
}
