/**
 * Credit packs. Server-side only: the client sends a pack id, never a price or a
 * credit count, so a tampered request cannot buy 10 000 credits for $4.99.
 *
 * Prices are quoted in USD cents, excluding tax. Stripe charges roughly
 * 2.9% + $0.30 per purchase, which is why no pack sits below $4.99.
 */
export type PackId = 'starter' | 'regular' | 'bulk';

export interface CreditPack {
  id: PackId;
  label: string;
  credits: number;
  priceCents: number;
  currency: 'usd';
}

export const PACKS: readonly CreditPack[] = [
  { id: 'starter', label: 'Starter', credits: 100, priceCents: 499, currency: 'usd' },
  { id: 'regular', label: 'Regular', credits: 300, priceCents: 1199, currency: 'usd' },
  { id: 'bulk', label: 'Bulk', credits: 1000, priceCents: 3499, currency: 'usd' },
] as const;

/** Resolves an untrusted pack id to the server's pack, or null. */
export function findPack(id: unknown): CreditPack | null {
  if (typeof id !== 'string') return null;
  return PACKS.find((pack) => pack.id === id) ?? null;
}
