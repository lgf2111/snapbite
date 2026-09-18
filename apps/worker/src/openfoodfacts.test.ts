import { describe, expect, it } from 'vitest';
import { lookupBarcode } from './openfoodfacts.js';

/** Builds a mock fetch returning the given JSON body with status 200. */
function mockFetch(body: unknown, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      status: ok ? 200 : 404,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;
}

describe('lookupBarcode', () => {
  it('maps a found product to per-100g macros + serving', async () => {
    const off = await lookupBarcode(
      '3017620422003',
      mockFetch({
        status: 1,
        product: {
          product_name: 'Nutella',
          serving_quantity: 15,
          nutriments: {
            'energy-kcal_100g': 539,
            proteins_100g: 6.3,
            carbohydrates_100g: 57.5,
            fat_100g: 30.9,
          },
        },
      }),
    );
    expect(off).not.toBeNull();
    expect(off?.name).toBe('Nutella');
    expect(off?.per100g.energyKcal).toBe(539);
    expect(off?.per100g.proteinG).toBe(6.3);
    expect(off?.servingG).toBe(15);
  });

  it('converts kJ energy when kcal is absent', async () => {
    const off = await lookupBarcode(
      '1234567',
      mockFetch({
        status: 1,
        product: { product_name: 'X', nutriments: { energy_100g: 2000 } },
      }),
    );
    // 2000 kJ / 4.184 ≈ 478
    expect(off?.per100g.energyKcal).toBeCloseTo(478, 0);
  });

  it('returns null when the product is not found (status 0)', async () => {
    const off = await lookupBarcode('0000000', mockFetch({ status: 0 }));
    expect(off).toBeNull();
  });

  it('returns null for a malformed barcode without fetching', async () => {
    let called = false;
    const spyFetch = (async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
    const off = await lookupBarcode('abc', spyFetch);
    expect(off).toBeNull();
    expect(called).toBe(false);
  });

  it('returns null when the product has no usable energy', async () => {
    const off = await lookupBarcode(
      '1234567',
      mockFetch({ status: 1, product: { product_name: 'X', nutriments: { proteins_100g: 5 } } }),
    );
    expect(off).toBeNull();
  });

  it('returns null on a fetch error', async () => {
    const throwing = (async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    expect(await lookupBarcode('1234567', throwing)).toBeNull();
  });
});
