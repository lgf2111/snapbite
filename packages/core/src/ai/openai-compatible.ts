import { AIFoodAnalysis } from '../schemas/analysis.js';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';
import {
  type AIProvider,
  AIProviderError,
  type AnalyzeMealOptions,
  type MealImage,
} from './types.js';

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

    const body = JSON.stringify({
      model: this.#model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildUserPrompt(opts.hint) },
            { type: 'image_url', image_url: imageUrl },
          ],
        },
      ],
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
        ...(opts.signal ? { signal: opts.signal } : {}),
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
    json = JSON.parse(content);
  } catch (cause) {
    throw new AIProviderError('parse', 'Model output was not valid JSON', { cause });
  }
  const result = AIFoodAnalysis.safeParse(json);
  if (!result.success) {
    throw new AIProviderError('parse', 'Model output did not match the expected schema', {
      cause: result.error,
    });
  }
  return result.data;
}
