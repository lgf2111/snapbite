import { describe, expect, it, vi } from 'vitest';
import { MockAIProvider } from './mock.js';
import { type FetchLike, OpenAICompatibleProvider } from './openai-compatible.js';
import { REVISE_SYSTEM_PROMPT } from './prompt.js';
import type { ReviseMealInput } from './types.js';

/** Builds an OpenAI-compatible response envelope whose content is `content`. */
function envelope(content: string) {
  return JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] });
}

function okFetch(bodyText: string): FetchLike {
  return vi.fn(async () => ({ ok: true, status: 200, text: async () => bodyText }));
}

const current: ReviseMealInput = {
  foods: [
    {
      name: 'white rice',
      estimatedWeightG: 200,
      portion: '1 bowl',
      quantity: 1,
      confidence: 0.9,
      aiNutrition: { energyKcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 },
    },
  ],
  confidence: 0.9,
  needsConfirmation: false,
};

const revised = {
  foods: [
    {
      name: 'white rice',
      estimatedWeightG: 200,
      portion: '1 bowl',
      quantity: 1,
      confidence: 0.9,
      aiNutrition: { energyKcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 },
    },
    {
      name: 'cola',
      estimatedWeightG: 330,
      portion: '1 can',
      quantity: 1,
      confidence: 0.8,
      aiNutrition: { energyKcal: 42, proteinG: 0, carbsG: 10.6, fatG: 0 },
    },
  ],
  confidence: 0.85,
  needsConfirmation: false,
};

describe('OpenAICompatibleProvider.reviseMeal', () => {
  it('sends a text-only JSON request (no image) with the current meal + instruction', async () => {
    const fetchMock = okFetch(envelope(JSON.stringify(revised)));
    const provider = new OpenAICompatibleProvider({
      providerId: 'deepseek',
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com',
      model: 'test-model',
      supportsDetail: true,
      fetch: fetchMock,
    });

    const result = await provider.reviseMeal(current, 'add a can of coke');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://api.example.com/chat/completions');
    const parsed = JSON.parse(init.body);
    // JSON mode, revise system prompt, no image block anywhere.
    expect(parsed.response_format).toEqual({ type: 'json_object' });
    expect(parsed.messages[0].content).toBe(REVISE_SYSTEM_PROMPT);
    expect(JSON.stringify(parsed)).not.toContain('image_url');
    // The user message carries the instruction as data.
    expect(parsed.messages[1].content).toContain('add a can of coke');
    expect(parsed.messages[1].content).toContain('white rice');
    // Output validated into the analysis shape.
    expect(result.foods).toHaveLength(2);
    expect(result.foods[1]?.name).toBe('cola');
  });

  it('rejects output that does not match the schema', async () => {
    const fetchMock = okFetch(envelope(JSON.stringify({ foods: [], confidence: 2 })));
    const provider = new OpenAICompatibleProvider({
      providerId: 'openai',
      apiKey: 'k',
      baseUrl: 'https://api.example.com',
      model: 'm',
      fetch: fetchMock,
    });
    await expect(provider.reviseMeal(current, 'noop')).rejects.toMatchObject({ kind: 'parse' });
  });
});

describe('MockAIProvider.reviseMeal', () => {
  it('echoes the current meal and records the instruction', async () => {
    const mock = new MockAIProvider();
    const result = await mock.reviseMeal(current, 'double the rice');
    expect(result.foods).toHaveLength(1);
    expect(result.notes).toBe('Revised: double the rice');
    expect(mock.lastRevision?.instruction).toBe('double the rice');
  });
});
