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

export interface DeepSeekConfig {
  /** The user's DeepSeek API key (decrypted in-memory by the Worker). */
  apiKey: string;
  /** Override the base URL (defaults to the DeepSeek production endpoint). */
  baseUrl?: string;
  /** Model id; defaults to the current Flash model. */
  model?: string;
  /** Injectable fetch. Defaults to the global `fetch`. */
  fetch?: FetchLike;
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-flash';

/**
 * DeepSeek implementation of {@link AIProvider}. Uses the OpenAI-compatible
 * Chat Completions endpoint with an inline base64 `image_url` and JSON output.
 *
 * The same request shape works for OpenAI with a different base URL + model, so
 * a future OpenAI adapter can reuse most of this.
 */
export class DeepSeekProvider implements AIProvider {
  readonly id = 'deepseek';
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #fetch: FetchLike;

  constructor(config: DeepSeekConfig) {
    if (!config.apiKey) {
      throw new AIProviderError('http', 'DeepSeek API key is required');
    }
    this.#apiKey = config.apiKey;
    this.#baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#model = config.model ?? DEFAULT_MODEL;
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
    const detail = opts.detail ?? 'low';
    const dataUrl = `data:${image.mimeType};base64,${image.base64}`;

    const body = JSON.stringify({
      model: this.#model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildUserPrompt(opts.hint) },
            { type: 'image_url', image_url: { url: dataUrl, detail } },
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
      throw new AIProviderError('network', 'DeepSeek request failed', { cause });
    }

    if (!response.ok) {
      // Read body for context but never surface the request (which held no key anyway).
      const detailText = await safeText(response);
      throw new AIProviderError('http', `DeepSeek returned HTTP ${response.status}`, {
        status: response.status,
        cause: detailText,
      });
    }

    const raw = await safeText(response);
    const content = extractContent(raw);
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
function extractContent(raw: string): string {
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch (cause) {
    throw new AIProviderError('parse', 'DeepSeek response was not valid JSON', { cause });
  }
  const content = (envelope as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]
    ?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new AIProviderError('empty', 'DeepSeek response had no message content');
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
