import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import type { BillingPack, BillingSummary } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import { hapticNotify } from '@/lib/telegram';
import { Check } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface CreditsCardProps {
  backend: Backend;
  /** Bumped after sign-in, so the card re-reads the summary. */
  refreshSignal?: number;
  /** Navigation seam for tests; defaults to the real Checkout redirect. */
  onNavigate?: (url: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function priceLabel(pack: BillingPack): string {
  return `$${(pack.priceCents / 100).toFixed(2)}`;
}

/** Readable at a glance: 100 for $4.99 is 5 cents each. */
function perCreditLabel(pack: BillingPack): string {
  return `$${(pack.priceCents / pack.credits / 100).toFixed(3)} / credit`;
}

function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Credits and the supporter tag. The tag is what unlocks Reports; credits only
 * pay for analyses run on our key. Deliberately one card: balance, trial,
 * packs, and the overflow switch in the same place, because they are one
 * decision — what happens when the user's own key hits its limit.
 */
export function CreditsCard({ backend, refreshSignal = 0, onNavigate }: CreditsCardProps) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  // Hidden developer affordance: long-press the balance to reveal a topup.
  const [devOpen, setDevOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await backend.billingSummary();
      setSummary(next);
      setStatus('ready');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load credits.');
      setStatus((current) => (current === 'ready' ? 'ready' : 'error'));
    }
  }, [backend]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `refreshSignal` deliberately re-reads the summary
  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    };
  }, []);

  async function buy(pack: BillingPack) {
    setBusy(`pack:${pack.id}`);
    try {
      const url = await backend.checkout(pack.id);
      (onNavigate ?? ((target: string) => window.location.assign(target)))(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start checkout.');
    } finally {
      setBusy(null);
    }
  }

  async function startTrial() {
    setBusy('trial');
    try {
      const result = await backend.startTrial();
      toast.success(
        result.granted
          ? 'Trial started: 20 credits and 14 days of Reports.'
          : 'This account has already used its trial.',
      );
      hapticNotify('success');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the trial.');
    } finally {
      setBusy(null);
    }
  }

  async function toggleOverflow(next: boolean) {
    if (!summary) return;
    const before = summary.overflowEnabled;
    setSummary({ ...summary, overflowEnabled: next });
    setBusy('overflow');
    try {
      await backend.setOverflowEnabled(next);
    } catch (err) {
      setSummary((current) => (current ? { ...current, overflowEnabled: before } : current));
      toast.error(err instanceof Error ? err.message : 'Could not change that setting.');
    } finally {
      setBusy(null);
    }
  }

  function startPress() {
    if (import.meta.env.PROD) return;
    cancelPress();
    pressTimer.current = setTimeout(() => setDevOpen(true), 700);
  }

  function cancelPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  async function devTopup() {
    if (!summary?.email) return;
    setBusy('dev');
    try {
      const balance = await backend.devTopup(summary.email, 100);
      setSummary((current) => (current ? { ...current, credits: balance } : current));
      toast.success(`Dev topup: ${balance} credits`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Dev topup failed.');
    } finally {
      setBusy(null);
    }
  }

  if (status === 'loading') {
    return (
      <div aria-busy="true">
        <Skeleton className="h-10 w-28 rounded-control" />
      </div>
    );
  }

  if (status === 'error' || !summary) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-caption">Could not load credits.</p>
        <Button variant="secondary" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  const trialActive = summary.trialUntil != null && summary.trialUntil > Date.now();
  const trialExpired = summary.trialUntil != null && summary.trialUntil <= Date.now();
  const signedIn = summary.signedIn;

  return (
    <div className="flex flex-col gap-4">
      {!signedIn ? (
        <p className="text-muted-foreground text-caption">
          Sign in with a verified email or Google to use credits and the trial. The free app and
          your own AI key never need an account.
        </p>
      ) : (
        <>
          <div
            className="flex select-none items-baseline gap-2"
            onPointerDown={startPress}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onPointerCancel={cancelPress}
            onContextMenu={(event) => event.preventDefault()}
          >
            <span className="tabular font-display text-numeral">{summary.credits}</span>
            <span className="text-muted-foreground text-caption">
              {summary.credits === 1 ? 'credit left' : 'credits left'}
            </span>
          </div>
          <p className="text-muted-foreground text-caption">
            {summary.source === 'byok'
              ? 'Your own AI key is connected, so analyses cost nothing.'
              : summary.credits > 0
                ? "Spent only when SnapBite's key runs an analysis or your key hits its limit."
                : 'Buy a pack, or add your own AI key in Settings to keep analyzing for free.'}
          </p>

          <div className="flex items-start gap-2 rounded-control border border-border p-3">
            {summary.supporter ? (
              <>
                <Check className="text-primary-text mt-0.5 size-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-body font-medium">
                    Supporter tag · {trialActive ? 'trial' : 'forever'}
                  </p>
                  <p className="text-muted-foreground text-caption">
                    {trialActive && summary.trialUntil
                      ? `Reports are unlocked until ${dateLabel(summary.trialUntil)}. Any pack keeps the tag after the trial.`
                      : 'Reports stay unlocked. The tag does not expire.'}
                  </p>
                </div>
              </>
            ) : (
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium">Supporter tag locked</p>
                <p className="text-muted-foreground text-caption">
                  {summary.trialAvailable
                    ? 'Start the trial for 20 credits and 14 days of Reports, once per verified email.'
                    : trialExpired
                      ? `Your trial ended ${summary.trialUntil ? dateLabel(summary.trialUntil) : ''}. Any pack unlocks Reports for good.`
                      : 'Buy any pack once and Reports stay unlocked for good.'}
                </p>
                {summary.trialAvailable && (
                  <Button
                    className="mt-2"
                    disabled={busy != null}
                    onClick={() => void startTrial()}
                  >
                    {busy === 'trial' ? 'Starting…' : 'Start free trial'}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-body font-medium">When my key hits its limit, use my credits</p>
              <p className="text-muted-foreground text-caption">
                One credit per analysis, up to {summary.overflowCap} a day. Used today:{' '}
                {summary.overflowUsedToday}/{summary.overflowCap}.
              </p>
            </div>
            <Switch
              aria-label="Use my credits when my key hits its limit"
              checked={summary.overflowEnabled}
              disabled={busy != null}
              onCheckedChange={(next) => void toggleOverflow(next)}
            />
          </div>
        </>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <p className="text-muted-foreground text-caption font-medium">Packs</p>
        {summary.packs.map((pack) => (
          <div
            key={pack.id}
            className="flex items-center justify-between gap-3 rounded-control border border-border p-3"
          >
            <div className="min-w-0">
              <p className="font-medium">{pack.label}</p>
              <p className="text-muted-foreground text-caption">
                {pack.credits} analyses · {perCreditLabel(pack)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="tabular text-body font-medium">{priceLabel(pack)}</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={!signedIn || busy != null}
                onClick={() => void buy(pack)}
              >
                {busy === `pack:${pack.id}` ? '…' : `Buy ${pack.label}`}
              </Button>
            </div>
          </div>
        ))}
        <p className="text-muted-foreground text-caption">
          Any pack unlocks the supporter tag permanently. Credits are prepaid analyses on SnapBite's
          key.
        </p>
      </div>

      {!import.meta.env.PROD && devOpen && signedIn && (
        <div className="flex flex-col gap-2 rounded-control border border-dashed border-border p-3">
          <p className="text-muted-foreground text-caption">
            Development only: grants 100 credits through ADMIN_TOKEN.
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy != null}
            onClick={() => void devTopup()}
          >
            {busy === 'dev' ? 'Adding…' : 'Add 100 credits'}
          </Button>
        </div>
      )}
    </div>
  );
}
