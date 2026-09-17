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
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    supportsDetail: false,
    keyHint: 'Get a free key at aistudio.google.com',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    supportsDetail: true,
    keyHint: 'Get a key at platform.openai.com',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
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
  fetch?: FetchLike;
}

/**
 * Builds an {@link AIProvider} for the given provider id + key. Unknown ids
 * fall back to the default provider's preset. Model defaults to the preset.
 */
export function createProvider(opts: CreateProviderOptions): AIProvider {
  const id = isProviderId(opts.providerId) ? opts.providerId : DEFAULT_PROVIDER_ID;
  const preset = PROVIDER_PRESETS[id];
  return new OpenAICompatibleProvider({
    providerId: preset.id,
    apiKey: opts.apiKey,
    baseUrl: preset.baseUrl,
    model: opts.model?.trim() || preset.defaultModel,
    supportsDetail: preset.supportsDetail,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}
