import type { AIFoodAnalysis } from '../schemas/analysis.js';

/**
 * A meal photo handed to the provider for analysis. Bytes are provided as a
 * base64 string plus the detected MIME type; the provider assembles the
 * data URL. Callers (Worker) discard the bytes after the call returns.
 */
export interface MealImage {
  /** Raw image bytes, base64-encoded (no `data:` prefix). */
  base64: string;
  /** One of the DeepSeek-supported types. */
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

/**
 * Options that tune a single analysis call.
 */
export interface AnalyzeMealOptions {
  /**
   * Free-text hint from the user ("this is lunch", "the sauce is teriyaki").
   * Appended to the user prompt; never trusted as instructions.
   */
  hint?: string;
  /**
   * Image detail level. `low` downscales to 512x512 — cheaper and enough for
   * food recognition. Defaults to `low`.
   */
  detail?: 'low' | 'high' | 'auto';
  /** Abort signal so the transport layer can enforce timeouts. */
  signal?: AbortSignal;
}

/**
 * Provider-agnostic contract for turning a meal photo into structured foods.
 * DeepSeek is the only implementation for now; an OpenAI adapter would sit
 * behind this same interface (same OpenAI-compatible request, different base
 * URL + model). `packages/core` depends only on this interface.
 */
export interface AIProvider {
  /** Stable identifier for logging/telemetry, e.g. `deepseek`. */
  readonly id: string;
  /** Analyze a meal photo into a validated, pre-nutrition food analysis. */
  analyzeMeal(image: MealImage, opts?: AnalyzeMealOptions): Promise<AIFoodAnalysis>;
}

/**
 * Error thrown when the provider call fails (transport, HTTP, or the model
 * returned output that does not match {@link AIFoodAnalysis}). Carries enough
 * context for the Worker to map to an HTTP response without leaking the key.
 */
export class AIProviderError extends Error {
  override readonly name = 'AIProviderError';
  readonly kind: 'http' | 'network' | 'parse' | 'empty';
  readonly status?: number;

  constructor(
    kind: AIProviderError['kind'],
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.kind = kind;
    this.status = options?.status;
  }
}
