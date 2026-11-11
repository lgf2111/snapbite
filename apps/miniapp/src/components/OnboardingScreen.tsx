import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Backend } from '@/lib/backend';
import { cn } from '@/lib/utils';
import {
  type DailyTargets,
  PROVIDER_PRESETS,
  type ProviderId,
  type UserProfile,
} from '@snapbite/core';
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

/** How long the welcome holds before the form fades in. */
const INTRO_MS = 1000;

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
   * The first run opens on a welcome that fades in, then the form fades in
   * beneath it. Reduced motion skips the intro and its wait entirely: a
   * one-second gate before the only actionable content is a tax on people who
   * asked for less motion. The key step (resume) never plays it either.
   */
  const [showIntro] = useState(
    () =>
      step === 'profile' &&
      !(
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
      ),
  );
  const [introDone, setIntroDone] = useState(!showIntro);
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (introDone) return;
    const timer = window.setTimeout(() => setIntroDone(true), INTRO_MS);
    return () => window.clearTimeout(timer);
  }, [introDone]);
  // The welcome keeps the first screenful; once the form is live the page
  // scrolls down to it. The welcome stays above, it is not unmounted.
  useEffect(() => {
    if (showIntro && introDone) {
      formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  }, [showIntro, introDone]);

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
      <div className="flex flex-1 flex-col gap-4 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-title">Add your AI key</h1>
          <p className="text-muted-foreground text-caption">
            The photo bot uses your own AI key to read meals from photos. Add one now to enable it —
            or skip and track meals manually in the app. You can add a key any time in Settings.
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
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {showIntro && (
        // In flow, not an absolute overlay: the layer scrolls, so an overlay sized
        // to the whole form would centre its text somewhere below the fold. This
        // block is exactly one screen tall (minus the safe areas the layer pads
        // with) and the form sits beneath it.
        <div
          data-testid="onboarding-intro"
          className="animate-in fade-in flex min-h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)_-_1rem)] flex-col items-center justify-center gap-2 text-center duration-500"
        >
          <h1 className="font-display text-display leading-tight">
            Welcome
            <br />
            to SnapBite
          </h1>
          <p className="text-muted-foreground text-caption">Let&rsquo;s set up your targets.</p>
        </div>
      )}

      <div
        ref={formRef}
        data-testid="onboarding-form"
        // Hidden from tab order and screen readers until it fades in, so nobody
        // fills an invisible form.
        inert={!introDone}
        className={cn(
          'flex scroll-mt-4 flex-col gap-4 py-4',
          introDone ? 'animate-in fade-in slide-in-from-bottom-2 duration-500' : 'opacity-0',
        )}
      >
        <div className="flex flex-col gap-1">
          {!showIntro && <h1 className="text-title">Welcome to SnapBite</h1>}
          <p className="text-muted-foreground text-caption">
            Tell us a bit about yourself to get daily calorie and macro targets. You can change
            these any time in Settings — or skip and just start logging (targets simply won&rsquo;t
            show yet).
          </p>
        </div>

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
    </div>
  );
}
