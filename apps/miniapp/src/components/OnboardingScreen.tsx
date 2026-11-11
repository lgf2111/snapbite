import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import type { Backend } from '@/lib/backend';
import { cn } from '@/lib/utils';
import {
  type DailyTargets,
  PROVIDER_PRESETS,
  type ProviderId,
  type UserProfile,
} from '@snapbite/core';
import { ArrowDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { markKeyDecision } from '../lib/onboarding.js';
import { KeyHelp } from './KeyHelp.js';
import { LinkifiedHint } from './LinkifiedHint.js';
import { ProfileForm } from './ProfileForm.js';

type ToastKind = 'success' | 'error' | 'info';

interface OnboardingScreenProps {
  backend: Backend;
  /** Open straight at the optional key step (profile already saved). */
  startAtKeyStep?: boolean;
  onDone: (targets: DailyTargets) => void;
  onSkip: () => void;
  onToast?: (kind: ToastKind, message: string) => void;
}

/**
 * First-run onboarding, two steps:
 *  1. Profile + goal (so the app can show daily targets).
 *  2. Optional AI key — needed only for the photo bot. Skippable: without a key
 *     you can still track meals manually in the app, so we frame it that way
 *     rather than blocking.
 * Both steps are skippable; the app is usable either way.
 */
/**
 * Where the user got to, so a reload (or a phone that backgrounds the tab) does
 * not throw away typed input. The profile is already saved server-side; this
 * only records that the key step is next, plus the unsaved key text.
 * Never used for anything sensitive beyond the user's own API key on their own
 * device, which they typed here moments ago.
 */
const RESUME_KEY = 'snapbite.onboarding.resume';

/** How long the welcome holds before the scroll-down cue fades in. */
const CUE_MS = 1000;
/** How long the form skeleton shows the first time the form panel is reached. */
const SKELETON_MS = 450;

interface ResumeState {
  step: 'profile' | 'apikey';
  provider?: ProviderId;
}

function readResume(): ResumeState | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResumeState;
    return parsed.step === 'apikey' || parsed.step === 'profile' ? parsed : null;
  } catch {
    return null;
  }
}

function writeResume(state: ResumeState | null): void {
  try {
    if (state) localStorage.setItem(RESUME_KEY, JSON.stringify(state));
    else localStorage.removeItem(RESUME_KEY);
  } catch {
    // Private mode: lose the resume, never break the screen.
  }
}

export function OnboardingScreen({
  backend,
  onDone,
  onSkip,
  onToast,
  startAtKeyStep,
}: OnboardingScreenProps) {
  const [step, setStep] = useState<'profile' | 'apikey'>(() => {
    const resume = readResume();
    // A saved profile (passed in) outranks a stale resume record.
    if (startAtKeyStep) return 'apikey';
    return resume?.step ?? 'profile';
  });
  const [saving, setSaving] = useState(false);
  const [savedTargets, setSavedTargets] = useState<DailyTargets | null>(null);

  /**
   * The first run is two snap panels, each one viewport tall: the welcome, then
   * the form. Reduced motion removes every wait and loop: the cue is simply
   * there, and the form is there the moment its panel is reached. The key step
   * (resume) is a single scrolling page and has none of this.
   */
  const [reduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  );
  const [cueShown, setCueShown] = useState(reduced);
  useEffect(() => {
    if (cueShown) return;
    const timer = window.setTimeout(() => setCueShown(true), CUE_MS);
    return () => window.clearTimeout(timer);
  }, [cueShown]);

  // The form mounts the first time its panel is reached and then stays mounted
  // (off-screen, not destroyed) so scrolling back keeps what was typed.
  const [reached, setReached] = useState(false);
  const [skeletonDone, setSkeletonDone] = useState(reduced);
  useEffect(() => {
    if (!reached || skeletonDone) return;
    const timer = window.setTimeout(() => setSkeletonDone(true), SKELETON_MS);
    return () => window.clearTimeout(timer);
  }, [reached, skeletonDone]);
  const formReady = reached && skeletonDone;

  // Snap fights the keyboard: a field focused low in the form gets pulled back
  // to a snap point. Switch snapping off while a field has focus.
  const [typing, setTyping] = useState(false);
  const formPanel = useRef<HTMLElement>(null);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.clientHeight > 0 && el.scrollTop > el.clientHeight * 0.5) setReached(true);
  }

  function scrollToForm() {
    setReached(true);
    formPanel.current?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }

  // API-key step state.
  const [provider, setProvider] = useState<ProviderId>(() => readResume()?.provider ?? 'gemini');
  const [apiKey, setApiKey] = useState('');

  // Remember only *where* the user got to (step + provider). The key itself is
  // never written to disk — it is a live credential, and the form is one paste.
  useEffect(() => {
    writeResume({ step, provider });
  }, [step, provider]);

  async function saveProfile(profile: UserProfile) {
    setSaving(true);
    try {
      const targets = await backend.saveProfile(profile);
      setSavedTargets(targets);
      onToast?.('success', 'Goal set');
      // Local/demo mode uses the mock analyzer (always "connected"), so there's
      // no key step. Worker mode advances to the optional key step.
      if (backend.mode === 'local') {
        onDone(targets);
      } else {
        setSaving(false);
        setStep('apikey');
      }
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not save');
      setSaving(false);
    }
  }

  async function saveKey() {
    const key = apiKey.trim();
    if (!key) return;
    setSaving(true);
    try {
      await backend.saveApiKey(key, provider);
      onToast?.('success', 'AI key saved');
      finishWithTargets();
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not save key');
      setSaving(false);
    }
  }

  function finishWithTargets() {
    writeResume(null);
    markKeyDecision('set');
    if (savedTargets) onDone(savedTargets);
    else onSkip();
  }

  if (step === 'apikey') {
    return (
      <div className="h-[100svh] overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top)] pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-title">Add your AI key</h1>
            <p className="text-muted-foreground text-caption">
              The photo bot uses your own AI key to read meals from photos. Add one now to enable it
              — or skip and track meals manually in the app. You can add a key any time in Settings.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="onb-provider">Provider</Label>
            <select
              id="onb-provider"
              className="border-input text-body h-9 rounded-md border bg-transparent px-3"
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderId)}
            >
              {Object.values(PROVIDER_PRESETS).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="onb-key">API key</Label>
            <Input
              id="onb-key"
              type="password"
              autoComplete="off"
              placeholder="paste your key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <LinkifiedHint
              text={PROVIDER_PRESETS[provider].keyHint}
              className="text-muted-foreground text-caption"
            />
          </div>

          <KeyHelp />

          <Button disabled={!apiKey.trim() || saving} onClick={() => void saveKey()}>
            {saving ? 'Saving…' : 'Save key & finish'}
          </Button>
          <Button
            variant="ghost"
            className="text-muted-foreground"
            disabled={saving}
            onClick={finishWithTargets}
          >
            Skip — I'll track meals manually
          </Button>
          <p className="text-muted-foreground text-center text-caption">
            Heads up: the photo bot won't analyze meals until a key is added.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="onboarding-scroller"
      onScroll={onScroll}
      onFocusCapture={(e) => {
        if (e.target instanceof HTMLElement && e.target.matches('input,select,textarea')) {
          setTyping(true);
        }
      }}
      onBlurCapture={(e) => {
        const next = e.relatedTarget;
        if (!(next instanceof HTMLElement && next.matches('input,select,textarea'))) {
          setTyping(false);
        }
      }}
      className={cn(
        'h-[100svh] snap-y overflow-y-auto overscroll-contain',
        typing ? 'snap-none' : 'snap-mandatory',
      )}
    >
      <section
        data-testid="onboarding-intro"
        className="relative flex h-[100svh] snap-start snap-always flex-col items-center justify-center gap-2 px-4 pt-[env(safe-area-inset-top)] pb-[calc(1rem+env(safe-area-inset-bottom))] text-center"
      >
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground absolute top-[calc(0.5rem+env(safe-area-inset-top))] right-3"
          disabled={saving}
          onClick={onSkip}
        >
          Skip for now
        </Button>

        <h1 className="motion-safe:animate-in motion-safe:fade-in font-display text-display leading-tight duration-500">
          Welcome
          <br />
          to SnapBite
        </h1>
        <p className="text-muted-foreground text-caption">Let&rsquo;s set up your targets.</p>

        {cueShown && (
          // A button, not decoration: it is the keyboard and switch path to the
          // form. The arrow is hidden from assistive tech; the words carry it.
          <button
            type="button"
            data-testid="scroll-cue"
            onClick={scrollToForm}
            className="motion-safe:animate-in motion-safe:fade-in text-muted-foreground text-caption absolute inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] mx-auto flex w-fit flex-col items-center gap-1 rounded-md px-3 py-2 duration-500 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span>Scroll down to set your goal</span>
            <ArrowDown className="text-primary-text motion-safe:animate-drift size-5" aria-hidden />
          </button>
        )}
      </section>

      <section
        ref={formPanel}
        data-testid="onboarding-form-panel"
        className="h-[100svh] snap-start snap-always scroll-pb-28 overflow-y-auto pt-[env(safe-area-inset-top)] pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
          {reached && !formReady && (
            <div data-testid="onboarding-skeleton" aria-hidden className="flex flex-col gap-4">
              <Skeleton className="h-5 w-3/4 rounded-md" />
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-11 w-full rounded-md" />
              ))}
              <Skeleton className="h-11 w-full rounded-md" />
            </div>
          )}

          {formReady && (
            <div
              data-testid="onboarding-form"
              className="motion-safe:animate-in motion-safe:fade-in flex flex-col gap-4 duration-300"
            >
              <p className="text-muted-foreground text-caption">
                Tell us a bit about yourself to get daily calorie and macro targets. You can change
                these any time in Settings — or skip and just start logging (targets simply
                won&rsquo;t show yet).
              </p>

              <ProfileForm
                initial={null}
                submitLabel="Set my goal"
                saving={saving}
                onSubmit={saveProfile}
              />

              <Button
                variant="ghost"
                className="text-muted-foreground"
                disabled={saving}
                onClick={onSkip}
              >
                Skip for now — I&rsquo;ll just start logging
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
