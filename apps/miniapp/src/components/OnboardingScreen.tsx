import type { DailyTargets, UserProfile } from '@foodlog/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
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
 * First-run onboarding: collects the user's profile + goal so the app can show
 * daily targets. Skippable — the app is usable without it (Home shows a soft
 * prompt instead of rings).
 */
export function OnboardingScreen({ backend, onDone, onSkip, onToast }: OnboardingScreenProps) {
  const [saving, setSaving] = useState(false);

  async function save(profile: UserProfile) {
    setSaving(true);
    try {
      const targets = await backend.saveProfile(profile);
      onToast?.('success', 'Goal set');
      onDone(targets);
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not save');
      setSaving(false);
    }
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

      <ProfileForm initial={null} submitLabel="Set my goal" saving={saving} onSubmit={save} />

      <Button variant="ghost" className="text-muted-foreground" disabled={saving} onClick={onSkip}>
        Skip for now
      </Button>
    </div>
  );
}
