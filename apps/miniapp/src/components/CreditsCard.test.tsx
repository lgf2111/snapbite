import type { BillingSummary } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreditsCard } from './CreditsCard.js';

const PACKS = [
  { id: 'starter', label: 'Starter', credits: 100, priceCents: 499, currency: 'usd' },
  { id: 'regular', label: 'Regular', credits: 300, priceCents: 1199, currency: 'usd' },
  { id: 'bulk', label: 'Bulk', credits: 1000, priceCents: 3499, currency: 'usd' },
];

function summary(over: Partial<BillingSummary> = {}): BillingSummary {
  return {
    signedIn: true,
    email: 'a@b.co',
    supporter: false,
    credits: 0,
    source: 'none',
    trialUntil: null,
    trialAvailable: false,
    overflowEnabled: true,
    overflowUsedToday: 0,
    overflowCap: 20,
    packs: PACKS,
    ...over,
  };
}

function stubBackend(over: Record<string, unknown>): Backend {
  return { mode: 'worker', ...over } as unknown as Backend;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CreditsCard', () => {
  it('invites a signed-out account to sign in and disables buying', async () => {
    const backend = stubBackend({
      billingSummary: vi.fn(async () =>
        summary({ signedIn: false, email: null, trialAvailable: false }),
      ),
    });
    render(<CreditsCard backend={backend} />);

    expect(await screen.findByText('Credits and supporter')).toBeInTheDocument();
    expect(screen.getByText(/sign in with a verified email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy Starter' })).toBeDisabled();
    // The per-credit price is shown for every pack.
    expect(screen.getByText(/0\.050 \/ credit/)).toBeInTheDocument();
    expect(screen.getByText(/0\.040 \/ credit/)).toBeInTheDocument();
    expect(screen.getByText(/0\.035 \/ credit/)).toBeInTheDocument();
  });

  it('shows the balance and the permanent supporter tag', async () => {
    const backend = stubBackend({
      billingSummary: vi.fn(async () =>
        summary({ credits: 43, supporter: true, source: 'credits' }),
      ),
    });
    render(<CreditsCard backend={backend} />);

    expect(await screen.findByText('43')).toBeInTheDocument();
    expect(screen.getByText('credits left')).toBeInTheDocument();
    expect(screen.getByText('Supporter tag · forever')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start free trial/i })).not.toBeInTheDocument();
  });

  it('turns the credit overflow setting off', async () => {
    const setOverflowEnabled = vi.fn(async () => {});
    const backend = stubBackend({
      billingSummary: vi.fn(async () => summary({ credits: 43 })),
      setOverflowEnabled,
    });
    render(<CreditsCard backend={backend} />);

    const toggle = await screen.findByRole('switch', {
      name: 'Use my credits when my key hits its limit',
    });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);

    await waitFor(() => expect(setOverflowEnabled).toHaveBeenCalledWith(false));
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('starts the trial and reloads the summary', async () => {
    const until = Date.now() + 14 * 24 * 60 * 60 * 1000;
    const billingSummary = vi
      .fn()
      .mockResolvedValueOnce(summary({ trialAvailable: true }))
      .mockResolvedValueOnce(
        summary({ credits: 20, supporter: true, trialUntil: until, trialAvailable: false }),
      );
    const startTrial = vi.fn(async () => ({ granted: true, trialUntil: until }));
    const backend = stubBackend({ billingSummary, startTrial });
    render(<CreditsCard backend={backend} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Start free trial' }));

    await waitFor(() => expect(startTrial).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Supporter tag · trial')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(billingSummary).toHaveBeenCalledTimes(2);
  });

  it('starts a Checkout Session for the chosen pack', async () => {
    const checkout = vi.fn(async () => 'https://checkout.stripe.com/c/pay/test');
    const onNavigate = vi.fn();
    const backend = stubBackend({
      billingSummary: vi.fn(async () => summary({ credits: 5, supporter: true })),
      checkout,
    });
    render(<CreditsCard backend={backend} onNavigate={onNavigate} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Buy Regular' }));

    await waitFor(() => expect(checkout).toHaveBeenCalledWith('regular'));
    expect(onNavigate).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/test');
  });

  it('reveals the hidden dev topup on a long press', async () => {
    const devTopup = vi.fn(async () => 143);
    const backend = stubBackend({
      billingSummary: vi.fn(async () => summary({ credits: 43 })),
      devTopup,
    });
    render(<CreditsCard backend={backend} />);

    const balance = await screen.findByText('43');
    expect(screen.queryByRole('button', { name: 'Add 100 credits' })).not.toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.pointerDown(balance);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    vi.useRealTimers();

    await userEvent.click(screen.getByRole('button', { name: 'Add 100 credits' }));
    await waitFor(() => expect(devTopup).toHaveBeenCalledWith('a@b.co', 100));
    expect(await screen.findByText('143')).toBeInTheDocument();
  });
});
