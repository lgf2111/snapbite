import type { MealResult } from '@snapbite/core';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, LOAD_FAILED_MESSAGE } from './api.js';

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
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => jsonResponse({ detail: 'Add your AI key' }, 400));
    const client = new ApiClient('https://api.example.com', () => 'X', fetchMock);
    await expect(client.analyze({ base64: 'x', mimeType: 'image/jpeg' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'Add your AI key',
    });
    errorSpy.mockRestore();
  });

  it('hides a bodyless error status behind a retry sentence', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response('', { status: 503 }));
    const client = new ApiClient('https://api.example.com', () => 'X', fetchMock);

    await expect(client.analytics('90d')).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      message: LOAD_FAILED_MESSAGE,
    });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
    expect(LOAD_FAILED_MESSAGE).not.toMatch(/HTTP/);
    errorSpy.mockRestore();
  });

  it('replaces a status code echoed in the server detail', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => jsonResponse({ detail: 'gemini returned HTTP 503' }, 503));
    const client = new ApiClient('https://api.example.com', () => 'X', fetchMock);

    await expect(client.analytics('90d')).rejects.toMatchObject({
      status: 503,
      message: LOAD_FAILED_MESSAGE,
    });
    errorSpy.mockRestore();
  });

  it('revises a meal (draft) via POST /api/meals/:id/revise and returns the meal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ meal }));
    const client = new ApiClient('https://api.example.com', () => 'X', fetchMock);
    const res = await client.reviseMeal('meal-9', 'add a coke');
    // Returns the draft MealResult unwrapped from { meal }.
    expect(res.total.energyKcal).toBe(260);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/api/meals/meal-9/revise');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({ instruction: 'add a coke' });
  });

  it('builds a thumbnail photo URL with w= and keeps initData in the query', () => {
    const client = new ApiClient('https://api.example.com', () => 'INIT DATA&1');
    const thumb = new URL(client.photoUrl('meal 1', { width: 240 }));
    expect(thumb.pathname).toBe('/api/meal-photo/meal%201');
    expect(thumb.searchParams.get('w')).toBe('240');
    expect(thumb.searchParams.get('initData')).toBe('INIT DATA&1');

    // The detail screen asks for no width: the Worker returns the original.
    const full = new URL(client.photoUrl('meal-2'));
    expect(full.searchParams.has('w')).toBe(false);
    expect(full.searchParams.get('initData')).toBe('INIT DATA&1');
  });

  it('saves a profile via PUT /api/settings/profile', async () => {
    const profile = {
      sex: 'male' as const,
      age: 30,
      heightCm: 180,
      weightKg: 80,
      activity: 'moderate' as const,
      goal: 'maintain' as const,
      units: 'metric' as const,
      mode: 'simple' as const,
    };
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        ok: true,
        profile,
        targets: { energyKcal: 2760, proteinG: 144, carbsG: 373, fatG: 77 },
      }),
    );
    const client = new ApiClient('https://api.example.com', () => 'X', fetchMock);
    const res = await client.saveProfile(profile);
    expect(res.targets.energyKcal).toBe(2760);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/api/settings/profile');
    expect(init.method).toBe('PUT');
  });

  it('exposes ApiError as an Error subclass', () => {
    expect(new ApiError(500, 'x')).toBeInstanceOf(Error);
  });
});
