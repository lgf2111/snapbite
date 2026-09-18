/**
 * Open Food Facts lookup: given a barcode (EAN/UPC), fetch the product's exact
 * per-100g nutrition. Best-effort — returns null on any miss/error so the
 * caller falls back to the AI's visual estimate. Free API, no key.
 */

export interface OffProduct {
  name: string;
  /** Per-100g nutrition (kcal + macros). */
  per100g: { energyKcal: number; proteinG: number; carbsG: number; fatG: number };
  /** Serving size in grams when the product declares one (else null). */
  servingG: number | null;
}

const OFF_BASE = 'https://world.openfoodfacts.org/api/v2/product';
const OFF_FIELDS = 'product_name,nutriments,serving_quantity';
/** Bound the lookup so a slow OFF response can't stall the whole webhook. */
const OFF_TIMEOUT_MS = 6000;

/** A number from an unknown JSON value, or null. */
function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Converts OFF `nutriments` energy to kcal per 100g. OFF exposes
 * `energy-kcal_100g` directly on most products; fall back to converting
 * `energy_100g` (kJ) when only that is present.
 */
function energyKcal(nutriments: Record<string, unknown>): number | null {
  const kcal = num(nutriments['energy-kcal_100g']);
  if (kcal != null) return kcal;
  const kj = num(nutriments['energy_100g']) ?? num(nutriments['energy-kj_100g']);
  return kj != null ? Math.round((kj / 4.184) * 10) / 10 : null;
}

/**
 * Looks up a product by barcode. Returns null when the barcode is invalid, the
 * product isn't found, the request errors/times out, or it lacks usable
 * nutrition. `fetchImpl` is injectable for tests.
 */
export async function lookupBarcode(
  barcode: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<OffProduct | null> {
  if (!/^\d{6,14}$/.test(barcode)) return null;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), OFF_TIMEOUT_MS);
  try {
    const url = `${OFF_BASE}/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`;
    const res = await fetchImpl(url, {
      signal: ac.signal,
      headers: { 'user-agent': 'FoodLog/1.0 (+telegram bot; contact via /feedback)' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      status?: number;
      product?: { product_name?: unknown; serving_quantity?: unknown; nutriments?: unknown };
    };
    // OFF returns status 1 when found, 0 when not.
    if (body.status !== 1 || !body.product?.nutriments) return null;

    const nutriments = body.product.nutriments as Record<string, unknown>;
    const kcal = energyKcal(nutriments);
    const proteinG = num(nutriments['proteins_100g']);
    const carbsG = num(nutriments['carbohydrates_100g']);
    const fatG = num(nutriments['fat_100g']);
    // Require at least energy to consider it usable.
    if (kcal == null) return null;

    const name =
      typeof body.product.product_name === 'string' && body.product.product_name.trim()
        ? body.product.product_name.trim()
        : 'Packaged product';

    return {
      name,
      per100g: {
        energyKcal: kcal,
        proteinG: proteinG ?? 0,
        carbsG: carbsG ?? 0,
        fatG: fatG ?? 0,
      },
      servingG: num(body.product.serving_quantity),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
