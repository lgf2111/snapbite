import { type FetchLike, OpenAICompatibleProvider } from './openai-compatible.js';
import { PROVIDER_PRESETS } from './registry.js';

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

/**
 * DeepSeek provider — a thin preset over {@link OpenAICompatibleProvider}, kept
 * for backward compatibility. New code should prefer `createProvider`.
 */
export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(config: DeepSeekConfig) {
    const preset = PROVIDER_PRESETS.deepseek;
    super({
      providerId: preset.id,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? preset.baseUrl,
      model: config.model ?? preset.defaultModel,
      supportsDetail: preset.supportsDetail,
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
  }
}
