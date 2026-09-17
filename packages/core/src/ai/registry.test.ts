import { describe, expect, it, vi } from 'vitest';
import { createProvider, DEFAULT_PROVIDER_ID, isProviderId, PROVIDER_PRESETS } from './registry.js';

const IMAGE = { base64: 'QUJD', mimeType: 'image/jpeg' } as const;

const validAnalysis = {
  foods: [{ name: 'Rice', estimatedWeightG: 180, quantity: 1, confidence: 0.8 }],
  confidence: 0.8,
  needsConfirmation: false,
};

function okFetch(content: string) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  }));
}

describe('provider registry', () => {
  it('defaults to gemini', () => {
    expect(DEFAULT_PROVIDER_ID).toBe('gemini');
  });

  it('recognizes known provider ids', () => {
    expect(isProviderId('gemini')).toBe(true);
    expect(isProviderId('deepseek')).toBe(true);
    expect(isProviderId('openai')).toBe(true);
    expect(isProviderId('nope')).toBe(false);
  });

  it('builds a Gemini provider hitting the OpenAI-compat endpoint, no detail field', async () => {
    const fetchMock = okFetch(JSON.stringify(validAnalysis));
    const provider = createProvider({ providerId: 'gemini', apiKey: 'k', fetch: fetchMock });
    expect(provider.id).toBe('gemini');
    await provider.analyzeMeal(IMAGE);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe(`${PROVIDER_PRESETS.gemini.baseUrl}/chat/completions`);
    const parsed = JSON.parse(init.body);
    expect(parsed.model).toBe('gemini-3.6-flash');
    const img = parsed.messages[1].content.find((c: { type: string }) => c.type === 'image_url');
    // Gemini's compat layer doesn't take `detail`; we must not send it.
    expect(img.image_url.detail).toBeUndefined();
  });

  it('sends detail=high for providers that support it (deepseek)', async () => {
    const fetchMock = okFetch(JSON.stringify(validAnalysis));
    const provider = createProvider({ providerId: 'deepseek', apiKey: 'k', fetch: fetchMock });
    await provider.analyzeMeal(IMAGE);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const img = JSON.parse(init.body).messages[1].content.find(
      (c: { type: string }) => c.type === 'image_url',
    );
    expect(img.image_url.detail).toBe('high');
  });

  it('honors a model override', async () => {
    const fetchMock = okFetch(JSON.stringify(validAnalysis));
    const provider = createProvider({
      providerId: 'gemini',
      apiKey: 'k',
      model: 'gemini-3.8-flash',
      fetch: fetchMock,
    });
    await provider.analyzeMeal(IMAGE);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body).model).toBe('gemini-3.8-flash');
  });

  it('falls back to the default provider for an unknown id (no baseUrl)', () => {
    const provider = createProvider({ providerId: 'bogus', apiKey: 'k' });
    expect(provider.id).toBe(DEFAULT_PROVIDER_ID);
  });

  it('builds a custom provider from a base URL for a non-preset id', async () => {
    const fetchMock = okFetch(JSON.stringify(validAnalysis));
    const provider = createProvider({
      providerId: 'custom',
      apiKey: 'k',
      baseUrl: 'https://my-llm.example.com/v1',
      model: 'my-vision-model',
      supportsDetail: true,
      fetch: fetchMock,
    });
    expect(provider.id).toBe('custom');
    await provider.analyzeMeal(IMAGE);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://my-llm.example.com/v1/chat/completions');
    expect(JSON.parse(init.body).model).toBe('my-vision-model');
  });

  it('every preset lists its defaultModel first in models[]', () => {
    for (const p of Object.values(PROVIDER_PRESETS)) {
      expect(p.models[0]).toBe(p.defaultModel);
    }
  });
});
