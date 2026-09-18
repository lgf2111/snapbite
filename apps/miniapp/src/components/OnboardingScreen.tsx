import { type DailyTargets, PROVIDER_PRESETS, type ProviderId, type UserProfile } from '@foodlog/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Backend } from '@/lib/backend';
import { ProfileForm } from './ProfileForm.js';

type ToastKind = 'success' | 'error' | 'info';

interface OnboardingScreenProps {
  backend: Backend;
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
export function OnboardingScreen({ backend, onDone, onSkip, onToast }: OnboardingScreenProps) {
  const [step, setStep] = useState<'profile' | 'apikey'>('profile');
  const [saving, setSaving] = useState(false);
  const [savedTargets, setSavedTargets] = useState<DailyTargets | null>(null);

  // API-key step state.
  const [provider, setProvider] = useState<ProviderId>('gemini');
  const [apiKey, setApiKey] = useState('');

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
    if (savedTargets) onDone(savedTargets);
    else onSkip();
  }

  if (step === 'apikey') {
    return (
      <div className="flex flex-1 flex-col gap-4 pb-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Add your AI key</h1>
          <p className="text-muted-foreground text-sm">
            The photo bot uses your own AI key to read meals from photos. Add one now to enable it —
            or skip and track meals manually in the app. You can add a key any time in Settings.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="onb-provider">Provider</Label>
          <select
            id="onb-provider"
            className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
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
          <p className="text-muted-foreground text-xs">{PROVIDER_PRESETS[provider].keyHint}</p>
        </div>

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
        <p className="text-muted-foreground text-center text-xs">
          Heads up: the photo bot won't analyze meals until a key is added.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 pb-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Welcome to FoodLog</h1>
        <p className="text-muted-foreground text-sm">
          Tell us a bit about yourself to get daily calorie and macro targets. You can change these
          any time in Settings, or skip for now.
        </p>
      </div>

      <ProfileForm initial={null} submitLabel="Set my goal" saving={saving} onSubmit={saveProfile} />

      <Button variant="ghost" className="text-muted-foreground" disabled={saving} onClick={onSkip}>
        Skip for now
      </Button>
    </div>
  );
}
