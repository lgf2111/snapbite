import type { MealResult } from '@foodlog/core';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './api.js';

const meal: MealResult = {
  foods: [
    {
      food: { name: 'rice', estimatedWeightG: 200, quantity: 1, confidence: 0.9 },
      nutrition: { energyKcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, source: 'table' },
    },
  ],
  total: { energyKcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, source: 'table' },
  confidence: 0.9,
  needsConfirmation: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ApiClient', () => {
  it('attaches the initData header on analyze', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(meal));
    const client = new ApiClient('https://api.example.com/', () => 'INIT_DATA_123', fetchMock);

    const result = await client.analyze({ base64: 'QUJD', mimeType: 'image/jpeg' }, 'lunch');

    expect(result.total.energyKcal).toBe(260);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/api/meals/analyze');
    const headers = new Headers(init.headers);
    expect(headers.get('x-telegram-init-data')).toBe('INIT_DATA_123');
    expect(JSON.parse(init.body as string)).toMatchObject({ base64: 'QUJD', hint: 'lunch' });
  });

  it('saves a meal via POST /api/meals', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'meal-1' }, 201));
    const client = new ApiClient('https://api.example.com', () => 'X', fetchMock);
    const res = await client.saveMeal(meal);
    expect(res.id).toBe('meal-1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/api/meals');
    expect(init.method).toBe('POST');
  });

  it('throws ApiError with the server detail on failure', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ detail: 'Add your AI key' }, 400));
    const client = new ApiClient('https://api.example.com', () => 'X', fetchMock);
    await expect(client.analyze({ base64: 'x', mimeType: 'image/jpeg' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'Add your AI key',
    });
  });

  it('revises a meal via POST /api/meals/:id/revise', async () => {
    const detail = { id: 'meal-9', foods: [{ name: 'rice' }] };
    const fetchMock = vi.fn(async () => jsonResponse(detail));
    const client = new ApiClient('https://api.example.com', () => 'X', fetchMock);
    const res = await client.reviseMeal('meal-9', 'add a coke');
    expect((res as { id: string }).id).toBe('meal-9');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/api/meals/meal-9/revise');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({ instruction: 'add a coke' });
  });

  it('exposes ApiError as an Error subclass', () => {
    expect(new ApiError(500, 'x')).toBeInstanceOf(Error);
  });
});
