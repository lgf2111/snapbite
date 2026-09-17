import type { AIProvider } from './types.js';
import { type FetchLike, OpenAICompatibleProvider } from './openai-compatible.js';

/** Known AI provider ids. */
export type ProviderId = 'gemini' | 'deepseek' | 'openai';

export interface ProviderPreset {
  id: ProviderId;
  /** Human label for the settings UI. */
  label: string;
  baseUrl: string;
  /** Default model id (models rotate; user can override). */
  defaultModel: string;
  /**
   * Curated list of known-good vision models for the settings dropdown. Best
   * effort — models rotate, so the UI also offers a "Custom…" free-text option.
   * `defaultModel` should appear first.
   */
  models: string[];
  /** Whether the endpoint honors `image_url.detail`. */
  supportsDetail: boolean;
  /** Where the user gets a key (shown in the UI). */
  keyHint: string;
}

/**
 * Provider presets. All are OpenAI-compatible Chat Completions endpoints with
 * vision + JSON output. Gemini is the recommended default (best food-vision
 * value); DeepSeek is cheapest; OpenAI (gpt-4o-mini) is a strong alternative.
 */
export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    // Gemini rotates model names and retires old ones; keep this current.
    defaultModel: 'gemini-3.6-flash',
    models: ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    supportsDetail: false,
    keyHint: 'Get a free key at aistudio.google.com',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
    supportsDetail: true,
    keyHint: 'Get a key at platform.openai.com',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-chat'],
    supportsDetail: true,
    keyHint: 'Get a key at platform.deepseek.com',
  },
};

export const DEFAULT_PROVIDER_ID: ProviderId = 'gemini';

/** True if `id` is a known provider. */
export function isProviderId(id: string): id is ProviderId {
  return id === 'gemini' || id === 'deepseek' || id === 'openai';
}

export interface CreateProviderOptions {
  providerId: string;
  apiKey: string;
  /** Optional model override; falls back to the preset default. */
  model?: string;
  /**
   * Custom OpenAI-compatible base URL (no trailing /chat/completions). When set
   * — or when `providerId` is `custom`/unknown — the provider is built directly
   * from this URL instead of a preset. For power users on any compatible API.
   */
  baseUrl?: string;
  /** Whether the custom endpoint honors `image_url.detail` (default false). */
  supportsDetail?: boolean;
  fetch?: FetchLike;
}

/**
 * Builds an {@link AIProvider} for the given provider id + key. A known preset
 * id (gemini/openai/deepseek) uses that preset; otherwise, if a `baseUrl` is
 * supplied (custom provider), it's built from that URL. Falls back to the
 * default preset only when neither applies.
 */
export function createProvider(opts: CreateProviderOptions): AIProvider {
  const model = opts.model?.trim();

  // Custom provider: any OpenAI-compatible endpoint the user configured.
  if (!isProviderId(opts.providerId) && opts.baseUrl?.trim()) {
    return new OpenAICompatibleProvider({
      providerId: 'custom',
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl.trim(),
      model: model || 'gpt-4o-mini',
      supportsDetail: opts.supportsDetail ?? false,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  const id = isProviderId(opts.providerId) ? opts.providerId : DEFAULT_PROVIDER_ID;
  const preset = PROVIDER_PRESETS[id];
  return new OpenAICompatibleProvider({
    providerId: preset.id,
    apiKey: opts.apiKey,
    baseUrl: preset.baseUrl,
    model: model || preset.defaultModel,
    supportsDetail: preset.supportsDetail,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}
