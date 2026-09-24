import { describe, expect, it, vi } from 'vitest';
import { DeepSeekProvider, type FetchLike } from './deepseek.js';
import { AIProviderError } from './types.js';

const IMAGE = { base64: 'QUJD', mimeType: 'image/jpeg' } as const;

/** Builds an OpenAI-compatible response envelope whose content is `content`. */
function envelope(content: string) {
  return JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] });
}

const validAnalysis = {
  foods: [
    {
      name: 'Rice',
      estimatedWeightG: 180,
      portion: '1 bowl',
      quantity: 1,
      confidence: 0.8,
    },
  ],
  confidence: 0.8,
  needsConfirmation: false,
};

function okFetch(bodyText: string): FetchLike {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => bodyText,
  }));
}

describe('DeepSeekProvider', () => {
  it('sends a correct OpenAI-compatible vision request', async () => {
    const fetchMock = okFetch(envelope(JSON.stringify(validAnalysis)));
    const provider = new DeepSeekProvider({ apiKey: 'sk-test', fetch: fetchMock });

    await provider.analyzeMeal(IMAGE, { hint: 'lunch' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, any][] } }).mock.calls[0];

    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(init.headers['Content-Type']).toBe('application/json');

    const parsed = JSON.parse(init.body);
    expect(parsed.model).toBe('deepseek-flash');
    expect(parsed.response_format).toEqual({ type: 'json_object' });

    // System message first, user message carries text + image.
    expect(parsed.messages[0].role).toBe('system');
    const user = parsed.messages[1];
    expect(user.role).toBe('user');
    const imageBlock = user.content.find((c: { type: string }) => c.type === 'image_url');
    expect(imageBlock.image_url.url).toBe('data:image/jpeg;base64,QUJD');
    // Default detail is now 'high' for better recognition accuracy.
    expect(imageBlock.image_url.detail).toBe('high');

    // Hint is included as data in the text block.
    const textBlock = user.content.find((c: { type: string }) => c.type === 'text');
    expect(textBlock.text).toContain('lunch');
  });

  it('parses a valid analysis from the response', async () => {
    const provider = new DeepSeekProvider({
      apiKey: 'sk-test',
      fetch: okFetch(envelope(JSON.stringify(validAnalysis))),
    });

    const result = await provider.analyzeMeal(IMAGE);
    expect(result.foods).toHaveLength(1);
    expect(result.foods[0]?.name).toBe('Rice');
    expect(result.needsConfirmation).toBe(false);
  });

  it('respects an explicit detail level and custom model/base URL', async () => {
    const fetchMock = okFetch(envelope(JSON.stringify(validAnalysis)));
    const provider = new DeepSeekProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://proxy.example.com/',
      model: 'custom-model',
      fetch: fetchMock,
    });

    await provider.analyzeMeal(IMAGE, { detail: 'high' });

    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, any][] } }).mock.calls[0];
    expect(url).toBe('https://proxy.example.com/chat/completions');
    const parsed = JSON.parse(init.body);
    expect(parsed.model).toBe('custom-model');
    const imageBlock = parsed.messages[1].content.find(
      (c: { type: string }) => c.type === 'image_url',
    );
    expect(imageBlock.image_url.detail).toBe('high');
  });

  it('throws an http error for non-ok responses', async () => {
    const provider = new DeepSeekProvider({
      apiKey: 'sk-test',
      fetch: vi.fn(async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })),
    });

    await expect(provider.analyzeMeal(IMAGE)).rejects.toMatchObject({
      name: 'AIProviderError',
      kind: 'http',
      status: 401,
    });
  });

  it('throws a network error when fetch rejects', async () => {
    const provider = new DeepSeekProvider({
      apiKey: 'sk-test',
      fetch: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    await expect(provider.analyzeMeal(IMAGE)).rejects.toMatchObject({ kind: 'network' });
  });

  it('throws an empty error when content is missing', async () => {
    const provider = new DeepSeekProvider({
      apiKey: 'sk-test',
      fetch: okFetch(JSON.stringify({ choices: [{ message: {} }] })),
    });

    await expect(provider.analyzeMeal(IMAGE)).rejects.toMatchObject({ kind: 'empty' });
  });

  it('throws a parse error when content is not valid JSON', async () => {
    const provider = new DeepSeekProvider({
      apiKey: 'sk-test',
      fetch: okFetch(envelope('not json at all')),
    });

    await expect(provider.analyzeMeal(IMAGE)).rejects.toMatchObject({ kind: 'parse' });
  });

  it('throws a parse error when JSON does not match the schema', async () => {
    const provider = new DeepSeekProvider({
      apiKey: 'sk-test',
      // foods empty -> schema rejects
      fetch: okFetch(envelope(JSON.stringify({ foods: [], confidence: 0.5, needsConfirmation: true }))),
    });

    await expect(provider.analyzeMeal(IMAGE)).rejects.toBeInstanceOf(AIProviderError);
  });

  it('requires an API key', () => {
    expect(() => new DeepSeekProvider({ apiKey: '' })).toThrow(AIProviderError);
  });

  // --- tolerance for common vision-model quirks (coercion before validation) ---

  it('coerces numeric strings, percent confidence, and missing quantity', async () => {
    const quirky = {
      foods: [
        {
          name: 'Grilled chicken',
          estimatedWeightG: '180', // string
          confidence: 90, // percent, not 0..1
          // quantity omitted
          aiNutrition: { energyKcal: '165', proteinG: '31', carbsG: '0', fatG: '3.6' },
        },
      ],
      confidence: '0.8',
      needsConfirmation: false,
    };
    const provider = new DeepSeekProvider({
      apiKey: 'sk-test',
      fetch: okFetch(envelope(JSON.stringify(quirky))),
    });
    const result = await provider.analyzeMeal(IMAGE);
    expect(result.foods[0]?.estimatedWeightG).toBe(180);
    expect(result.foods[0]?.quantity).toBe(1);
    expect(result.foods[0]?.confidence).toBeCloseTo(0.9, 5);
    expect(result.foods[0]?.aiNutrition?.energyKcal).toBe(165);
  });

  it('drops an empty/invalid barcode instead of rejecting the meal', async () => {
    const withBadBarcode = {
      foods: [{ name: 'Snack', estimatedWeightG: 50, confidence: 0.7, barcode: '' }],
      confidence: 0.7,
      needsConfirmation: false,
    };
    const provider = new DeepSeekProvider({
      apiKey: 'sk-test',
      fetch: okFetch(envelope(JSON.stringify(withBadBarcode))),
    });
    const result = await provider.analyzeMeal(IMAGE);
    expect(result.foods).toHaveLength(1);
    expect(result.foods[0]?.barcode).toBeUndefined();
  });

  it('strips ```json code fences the model may wrap output in', async () => {
    const fenced = `\`\`\`json\n${JSON.stringify(validAnalysis)}\n\`\`\``;
    const provider = new DeepSeekProvider({
      apiKey: 'sk-test',
      fetch: okFetch(envelope(fenced)),
    });
    const result = await provider.analyzeMeal(IMAGE);
    expect(result.foods[0]?.name).toBe('Rice');
  });

  it('skips a food missing a usable weight but keeps the good ones', async () => {
    const mixed = {
      foods: [
        { name: 'No weight', confidence: 0.5 }, // dropped (no weight)
        { name: 'Rice', estimatedWeightG: 200, confidence: 0.8 }, // kept
      ],
      confidence: 0.7,
      needsConfirmation: false,
    };
    const provider = new DeepSeekProvider({
      apiKey: 'sk-test',
      fetch: okFetch(envelope(JSON.stringify(mixed))),
    });
    const result = await provider.analyzeMeal(IMAGE);
    expect(result.foods).toHaveLength(1);
    expect(result.foods[0]?.name).toBe('Rice');
  });

  it('includes which fields failed in the parse error message', async () => {
    const provider = new DeepSeekProvider({
      apiKey: 'sk-test',
      // No salvageable foods -> still rejected, but with a helpful message.
      fetch: okFetch(envelope(JSON.stringify({ foods: [], confidence: 0.5, needsConfirmation: true }))),
    });
    await expect(provider.analyzeMeal(IMAGE)).rejects.toMatchObject({
      kind: 'parse',
      message: expect.stringContaining('foods'),
    });
  });
});
