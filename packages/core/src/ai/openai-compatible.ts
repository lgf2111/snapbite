import { AIFoodAnalysis } from '../schemas/analysis.js';
import {
  buildRevisePrompt,
  buildUserPrompt,
  REVISE_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from './prompt.js';
import {
  type AIProvider,
  AIProviderError,
  type AnalyzeMealOptions,
  type MealImage,
  type ReviseMealInput,
  type ReviseMealOptions,
} from './types.js';

/** A single OpenAI-style chat message. */
type ChatMessage = {
  role: 'system' | 'user';
  content: string | Array<Record<string, unknown>>;
};

/** Minimal `fetch` signature so the adapter can be driven by a mock in tests. */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface OpenAICompatibleConfig {
  /** Stable id for logging/telemetry (e.g. `deepseek`, `gemini`, `openai`). */
  providerId: string;
  /** The user's API key (decrypted in-memory by the Worker). */
  apiKey: string;
  /** Base URL of the OpenAI-compatible endpoint (no trailing /chat/completions). */
  baseUrl: string;
  /** Model id. */
  model: string;
  /** Whether the provider honors the `image_url.detail` field (DeepSeek/OpenAI do). */
  supportsDetail?: boolean;
  /** Injectable fetch. Defaults to the global `fetch` (bound to globalThis). */
  fetch?: FetchLike;
}

/**
 * Generic provider for any OpenAI-compatible Chat Completions endpoint with
 * vision (`image_url`) and JSON output. Covers DeepSeek, Gemini (via its
 * `/v1beta/openai/` endpoint), and OpenAI, differing only by base URL + model.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #supportsDetail: boolean;
  readonly #fetch: FetchLike;

  constructor(config: OpenAICompatibleConfig) {
    if (!config.apiKey) {
      throw new AIProviderError('http', `${config.providerId} API key is required`);
    }
    this.id = config.providerId;
    this.#apiKey = config.apiKey;
    this.#baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.#model = config.model;
    this.#supportsDetail = config.supportsDetail ?? false;

    const injected = config.fetch;
    const globalFetch = (globalThis as { fetch?: unknown }).fetch;
    if (injected) {
      this.#fetch = injected;
    } else if (typeof globalFetch === 'function') {
      // Bind to globalThis so `fetch` keeps its `this` (workerd/browsers throw
      // "Illegal invocation" when an unbound fetch reference is called).
      this.#fetch = (globalFetch as (...a: unknown[]) => unknown).bind(
        globalThis,
      ) as unknown as FetchLike;
    } else {
      throw new AIProviderError('network', 'No fetch implementation available');
    }
  }

  async analyzeMeal(image: MealImage, opts: AnalyzeMealOptions = {}): Promise<AIFoodAnalysis> {
    const dataUrl = `data:${image.mimeType};base64,${image.base64}`;
    const imageUrl: { url: string; detail?: string } = { url: dataUrl };
    if (this.#supportsDetail) imageUrl.detail = opts.detail ?? 'high';

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildUserPrompt(opts.hint) },
          { type: 'image_url', image_url: imageUrl },
        ],
      },
    ];
    return this.#complete(messages, opts.signal);
  }

  async reviseMeal(
    current: ReviseMealInput,
    instruction: string,
    opts: ReviseMealOptions = {},
  ): Promise<AIFoodAnalysis> {
    const messages: ChatMessage[] = [
      { role: 'system', content: REVISE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildRevisePrompt(JSON.stringify(current), instruction),
      },
    ];
    return this.#complete(messages, opts.signal);
  }

  /** Posts a JSON-mode chat completion and validates the result. */
  async #complete(messages: ChatMessage[], signal?: AbortSignal): Promise<AIFoodAnalysis> {
    const body = JSON.stringify({
      model: this.#model,
      response_format: { type: 'json_object' },
      messages,
    });

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.#apiKey}`,
        },
        body,
        ...(signal ? { signal } : {}),
      });
    } catch (cause) {
      throw new AIProviderError('network', `${this.id} request failed`, { cause });
    }

    if (!response.ok) {
      const detailText = await safeText(response);
      throw new AIProviderError('http', `${this.id} returned HTTP ${response.status}`, {
        status: response.status,
        cause: detailText,
      });
    }

    const raw = await safeText(response);
    const content = extractContent(raw, this.id);
    return parseAnalysis(content);
  }
}

async function safeText(response: { text(): Promise<string> }): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Pulls the assistant message content out of an OpenAI-compatible response
 * envelope: `{ choices: [{ message: { content } }] }`.
 */
function extractContent(raw: string, providerId: string): string {
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch (cause) {
    throw new AIProviderError('parse', `${providerId} response was not valid JSON`, { cause });
  }
  const content = (envelope as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]
    ?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new AIProviderError('empty', `${providerId} response had no message content`);
  }
  return content;
}

/** Parses the model's JSON content and validates it against the schema. */
function parseAnalysis(content: string): AIFoodAnalysis {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFences(content));
  } catch (cause) {
    throw new AIProviderError('parse', 'Model output was not valid JSON', { cause });
  }
  // Repair the common, harmless quirks vision models produce (numbers as
  // strings, an empty/echoed barcode, confidence as a percent, a missing
  // quantity, unusable foods) BEFORE validating, so formatting noise doesn't
  // reject an otherwise-good meal. The strict schema is still the final gate.
  const result = AIFoodAnalysis.safeParse(coerceAnalysis(json));
  if (!result.success) {
    // Include a short summary of which fields failed so it's diagnosable.
    const summary = result.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new AIProviderError(
      'parse',
      `Model output did not match the expected schema — ${summary}`,
      { cause: result.error },
    );
  }
  return result.data;
}

/** Strips ```json … ``` fences some models wrap JSON in despite instructions. */
function stripCodeFences(s: string): string {
  const t = s.trim();
  if (t.startsWith('```')) {
    return t
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }
  return t;
}

/** A finite number from a number or numeric string, else undefined. */
function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Clamps a confidence-ish value into [0,1] (accepts 0–100 percentages). */
function coerceConfidence(v: unknown): number {
  const n = num(v);
  if (n === undefined) return 0.6; // reasonable default when the model omits it
  const scaled = n > 1 ? n / 100 : n; // "85" → 0.85
  return Math.max(0, Math.min(1, scaled));
}

/** Coerces optional per-100g nutrition; drops it unless all four are numbers. */
function coerceNutrition(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const energyKcal = num(o.energyKcal);
  const proteinG = num(o.proteinG);
  const carbsG = num(o.carbsG);
  const fatG = num(o.fatG);
  if ([energyKcal, proteinG, carbsG, fatG].some((x) => x === undefined)) return undefined;
  return {
    energyKcal: Math.max(0, energyKcal as number),
    proteinG: Math.max(0, proteinG as number),
    carbsG: Math.max(0, carbsG as number),
    fatG: Math.max(0, fatG as number),
  };
}

/**
 * Normalizes a raw model object into the shape {@link AIFoodAnalysis} expects,
 * repairing common quirks and dropping foods that can't be salvaged. Never
 * throws — a malformed input just yields a best-effort object that validation
 * will accept or reject.
 */
function coerceAnalysis(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const o = input as Record<string, unknown>;

  const rawFoods = Array.isArray(o.foods) ? o.foods : [];
  const foods = rawFoods
    .map((f) => {
      if (!f || typeof f !== 'object') return null;
      const food = f as Record<string, unknown>;
      const name = typeof food.name === 'string' ? food.name.trim() : '';
      const weight = num(food.estimatedWeightG);
      // A food needs at least a name and a positive weight to be usable.
      if (!name || weight === undefined || weight <= 0) return null;

      const out: Record<string, unknown> = {
        name,
        estimatedWeightG: weight,
        confidence: coerceConfidence(food.confidence),
      };
      const qty = num(food.quantity);
      out.quantity = qty !== undefined && qty > 0 ? qty : 1;
      if (typeof food.portion === 'string' && food.portion.trim()) out.portion = food.portion.trim();

      const aiN = coerceNutrition(food.aiNutrition);
      if (aiN) out.aiNutrition = aiN;
      const manualN = coerceNutrition(food.manualNutrition);
      if (manualN) out.manualNutrition = manualN;

      // Only keep a barcode that's the expected 6–14 digits; drop empties/junk.
      if (typeof food.barcode === 'string') {
        const digits = food.barcode.replace(/\D/g, '');
        if (digits.length >= 6 && digits.length <= 14) out.barcode = digits;
      }
      return out;
    })
    .filter((f): f is Record<string, unknown> => f !== null);

  const result: Record<string, unknown> = {
    foods,
    confidence: coerceConfidence(o.confidence),
    needsConfirmation: typeof o.needsConfirmation === 'boolean' ? o.needsConfirmation : foods.length === 0,
  };
  if (typeof o.title === 'string' && o.title.trim()) result.title = o.title.trim();
  if (typeof o.notes === 'string' && o.notes.trim()) result.notes = o.notes.trim();
  return result;
}
