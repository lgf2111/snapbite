import { Section } from '@/components/Section';
import { Button } from '@/components/ui/button';
import { Collapsible } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { SettingsView } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import { cacheKey, getCached, mutateCached, revalidate, setCached } from '@/lib/cache';
import {
  type WeekMode,
  type WeekPrefs,
  type WeekStart,
  loadWeekPrefs,
  saveWeekPrefs,
} from '@/lib/weekPrefs';
import {
  DEFAULT_REMINDER_TIMES,
  FEEDBACK_MAX_LEN,
  GOAL_LABELS,
  PROVIDER_PRESETS,
  type ProviderId,
  REMINDER_STEP_MINUTES,
  type UserProfile,
  profileAge,
  snapToReminderStep,
} from '@snapbite/core';
import { CheckCircle2, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AccountCard } from './AccountCard.js';
import { CreditsCard } from './CreditsCard.js';
import { ExportData } from './ExportData.js';
import { ExternalLink } from './ExternalLink.js';
import { InfoDisclosure } from './InfoDisclosure.js';
import { LinkifiedHint } from './LinkifiedHint.js';
import { MacroLine } from './MacroLine.js';
import { ProfileForm } from './ProfileForm.js';
import { type ProviderConfig, ProviderPicker } from './ProviderPicker.js';
import { PushReminders } from './PushReminders.js';
import { ShortcutCard } from './ShortcutCard.js';

interface SettingsScreenProps {
  backend: Backend;
  /** Called after the profile is saved, so the app can refresh Home targets. */
  onProfileSaved?: () => void;
}

const GROUPS = ['Today’s targets', 'Logging and AI', 'One-tap logging', 'Account and data'];

/** Builds a ProviderConfig from stored settings fields. */
function cfgFromSettings(
  provider: string | null | undefined,
  model: string | null | undefined,
  baseUrl: string | null | undefined,
  supportsDetail: boolean | undefined,
): ProviderConfig {
  const isPreset = provider === 'gemini' || provider === 'openai' || provider === 'deepseek';
  const p: ProviderConfig['provider'] = isPreset
    ? provider
    : provider === 'custom'
      ? 'custom'
      : 'gemini';
  return {
    provider: p,
    model: model ?? (p === 'custom' ? '' : PROVIDER_PRESETS[p].defaultModel),
    baseUrl: baseUrl ?? '',
    supportsDetail: Boolean(supportsDetail),
  };
}

/** `Gemini · gemini-3.6-flash`: the saved provider and model on one line. */
function providerSummary(settings: SettingsView): string {
  const cfg = cfgFromSettings(
    settings.aiProvider,
    settings.aiModel,
    settings.customBaseUrl,
    settings.customSupportsDetail,
  );
  const provider = cfg.provider === 'custom' ? 'Custom' : PROVIDER_PRESETS[cfg.provider].label;
  return `${provider} · ${cfg.model || 'custom model'}`;
}

/** Per-provider "how to get a key" steps + the console URL. */
const KEY_GUIDE: Record<ProviderId, { url: string; steps: string[] }> = {
  gemini: {
    url: 'https://aistudio.google.com/apikey',
    steps: [
      'Open Google AI Studio and sign in with a Google account.',
      'Click "Create API key" (a project is auto-created for new users).',
      'Copy the key and paste it above. Free tier works; add billing to lift limits.',
    ],
  },
  openai: {
    url: 'https://platform.openai.com/api-keys',
    steps: [
      'Open the OpenAI API keys page and sign in.',
      'Click "Create new secret key" and copy it (shown only once).',
      'Add a payment method under Settings → Billing (no free tier).',
    ],
  },
  deepseek: {
    url: 'https://platform.deepseek.com',
    steps: [
      'Open the DeepSeek platform and sign up.',
      'Go to "API keys" and click "Create new API key"; copy it now.',
      'Add credit in the console (pay-as-you-go).',
    ],
  },
};

/** An expandable "how to get a key" guide for the given provider. */
function KeyGuide({ provider }: { provider: ProviderId }) {
  const guide = KEY_GUIDE[provider];
  return (
    <InfoDisclosure title={`How to get a ${PROVIDER_PRESETS[provider].label} key`}>
      <ol className="list-decimal space-y-1 pl-4">
        {guide.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <ExternalLink href={guide.url} className="text-primary-text underline">
        Open {new URL(guide.url).host} ↗
      </ExternalLink>
    </InfoDisclosure>
  );
}

export function SettingsScreen({ backend, onProfileSaved }: SettingsScreenProps) {
  // Seed synchronously so a warm cache renders the screen on first paint (no
  // skeleton); the effect below applies the derived state and revalidates.
  const [settings, setSettings] = useState<SettingsView | null>(
    () => getCached<SettingsView>(cacheKey.settings()) ?? null,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [primaryCfg, setPrimaryCfg] = useState<ProviderConfig>({
    provider: 'gemini',
    model: PROVIDER_PRESETS.gemini.defaultModel,
    baseUrl: '',
    supportsDetail: false,
  });
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [sendingFeedback, setSendingFeedback] = useState(false);
  // Bumped after sign-in so the credits card re-reads its summary.
  const [accountVersion, setAccountVersion] = useState(0);
  // Each slot has its own on/off toggle + time. `times` always holds all three
  // slots (so a toggled-off slot keeps its time); `slotOn` tracks which are
  // enabled. We persist only the enabled slots' times to the backend.
  const [slotOn, setSlotOn] = useState<Record<string, boolean>>({
    breakfast: false,
    lunch: false,
    dinner: false,
  });
  const [reminderTimes, setReminderTimes] =
    useState<Record<string, string>>(DEFAULT_REMINDER_TIMES);
  // Committed snapshots (last saved) — used to detect unsaved changes so edits
  // to the time pickers don't hit the network on every scroll tick.
  const [savedSlotOn, setSavedSlotOn] = useState<Record<string, boolean>>({
    breakfast: false,
    lunch: false,
    dinner: false,
  });
  const [savedTimes, setSavedTimes] = useState<Record<string, string>>(DEFAULT_REMINDER_TIMES);
  const [savingReminders, setSavingReminders] = useState(false);
  // Adaptive targets (opt-in) + a quick weight check-in.
  const [adaptiveOn, setAdaptiveOn] = useState(false);
  const [savingAdaptive, setSavingAdaptive] = useState(false);
  const [latestWeightKg, setLatestWeightKg] = useState<number | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const [weightError, setWeightError] = useState('');
  const [savingWeight, setSavingWeight] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  // Null means "follow the account": collapsed once connected, expanded for a
  // new user. A real true/false is the person's own choice and outranks the
  // account default on every later visit this session.
  const [aiKeyOpen, setAiKeyOpen] = useState<boolean | null>(
    () => getCached<boolean>(cacheKey.settingsAiKeyOpen()) ?? null,
  );
  const aiKeyPanelId = useId();

  // How the Home "Weekly" view defines a week (client-only, localStorage).
  // `saveWeekPrefs` writes the same store synchronously, so unlike the server
  // settings there is no sessionStorage key to rewrite here.
  const [weekPrefs, setWeekPrefs] = useState<WeekPrefs>(() => loadWeekPrefs());
  function updateWeekPrefs(patch: Partial<WeekPrefs>) {
    setWeekPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveWeekPrefs(next);
      return next;
    });
  }
  const [fbCfg, setFbCfg] = useState<ProviderConfig>({
    provider: 'openai',
    model: PROVIDER_PRESETS.openai.defaultModel,
    baseUrl: '',
    supportsDetail: false,
  });
  const [fbKey, setFbKey] = useState('');
  const [savingFb, setSavingFb] = useState(false);
  const [fbEnabled, setFbEnabled] = useState(false);

  const apiKeyRef = useRef<HTMLInputElement>(null);
  const fbKeyRef = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  // Latest settings for handlers that merge a partial mutation response.
  const settingsRef = useRef<SettingsView | null>(settings);
  settingsRef.current = settings;
  // Bumped when a mutation starts, so a revalidation that began earlier cannot
  // paint its older snapshot back over the local patch when it lands.
  const mutationEpoch = useRef(0);

  useEffect(() => {
    const apply = (s: SettingsView) => {
      setSettings(s);
      settingsRef.current = s;
      setPrimaryCfg(
        cfgFromSettings(s.aiProvider, s.aiModel, s.customBaseUrl, s.customSupportsDetail),
      );
      if (s.fallbackProvider) {
        setFbCfg(
          cfgFromSettings(
            s.fallbackProvider,
            s.fallbackModel,
            s.fallbackBaseUrl,
            s.fallbackSupportsDetail,
          ),
        );
      }
      setFbEnabled(Boolean(s.fallbackEnabled));
      setAdaptiveOn(Boolean(s.adaptive?.enabled));
      setLatestWeightKg(s.latestWeightKg ?? null);
      hydrateReminders(s);
    };

    // Render cached settings instantly, then revalidate in the background.
    const cached = getCached<SettingsView>(cacheKey.settings());
    if (cached) apply(cached);
    const epoch = mutationEpoch.current;
    revalidate<SettingsView>(cacheKey.settings(), () => backend.getSettings())
      .then((s) => {
        setLoadFailed(false);
        // A mutation started after this fetch did; its local patch is newer.
        if (mutationEpoch.current !== epoch) return;
        apply(s);
      })
      .catch(() => {
        if (!cached) setLoadFailed(true);
      });
  }, [backend]);

  const isLocal = backend.mode === 'local';
  const primaryConnected = Boolean(settings?.connected);
  const aiKeyExpanded = aiKeyOpen ?? !primaryConnected;
  const loading = settings == null && !loadFailed;

  function setAiKeyExpanded(open: boolean) {
    setAiKeyOpen(open);
    setCached(cacheKey.settingsAiKeyOpen(), open);
  }

  /**
   * Writes the view and its cache together. Every settings mutation must go
   * through here: a warm cache is what the next mount paints, so a silent state
   * update shows the pre-mutation value again after a tab switch or reload.
   */
  function commitSettings(next: SettingsView) {
    settingsRef.current = next;
    setSettings(next);
    mutateCached(cacheKey.settings(), next);
  }

  /**
   * Merges a mutation response into the current view. A PUT such as adaptive,
   * reminders or weight returns only `{ ok, <field> }`; replacing the whole
   * view with it would drop profile, targets, reminders and fallback state.
   */
  function mergeSettings(patch: Partial<SettingsView>) {
    const prev = settingsRef.current;
    if (prev) commitSettings({ ...prev, ...patch });
  }

  /** Marks the start of a user mutation (see the mount revalidation above). */
  function beginMutation() {
    mutationEpoch.current += 1;
  }

  async function handleToggleFallback(on: boolean) {
    beginMutation();
    setFbEnabled(on);
    // Toggling only flips enabled — the stored key is KEPT so the user can
    // re-enable without re-entering it. (An unsaved draft just expands/collapses.)
    if (settings?.fallbackConnected) {
      setSavingFb(true);
      try {
        const updated = await backend.setFallbackEnabled(on);
        mergeSettings({ fallbackEnabled: updated.fallbackEnabled ?? on });
        setFbEnabled(updated.fallbackEnabled ?? on);
      } catch (e) {
        setFbEnabled(!on); // revert on failure
        toast.error(e instanceof Error ? e.message : 'Could not update fallback');
      } finally {
        setSavingFb(false);
      }
    }
  }

  async function handleSave() {
    const key = apiKey.trim();
    if (!key) {
      apiKeyRef.current?.focus();
      return;
    }
    if (primaryCfg.provider === 'custom' && !/^https:\/\/.+/i.test(primaryCfg.baseUrl.trim())) {
      toast.error('Enter a valid https base URL for the custom provider');
      return;
    }
    setSaving(true);
    beginMutation();
    try {
      const custom =
        primaryCfg.provider === 'custom'
          ? { baseUrl: primaryCfg.baseUrl.trim(), supportsDetail: primaryCfg.supportsDetail }
          : undefined;
      const updated = await backend.saveApiKey(
        key,
        primaryCfg.provider,
        primaryCfg.model.trim() || undefined,
        custom,
      );
      mergeSettings(updated);
      setApiKey('');
      toast.success('Settings saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save key');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveFallback() {
    const key = fbKey.trim();
    if (!key) {
      fbKeyRef.current?.focus();
      return;
    }
    if (fbCfg.provider === 'custom' && !/^https:\/\/.+/i.test(fbCfg.baseUrl.trim())) {
      toast.error('Enter a valid https base URL for the custom provider');
      return;
    }
    setSavingFb(true);
    beginMutation();
    try {
      const custom =
        fbCfg.provider === 'custom'
          ? { baseUrl: fbCfg.baseUrl.trim(), supportsDetail: fbCfg.supportsDetail }
          : undefined;
      const updated = await backend.saveFallback(
        key,
        fbCfg.provider,
        fbCfg.model.trim() || undefined,
        custom,
      );
      mergeSettings(updated);
      // Saving a fallback enables it; keep the switch truthful even when the
      // response is only the partial `{ ok, fallbackConnected, … }` shape.
      setFbEnabled(updated.fallbackEnabled ?? true);
      setFbKey('');
      toast.success('Fallback saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save fallback');
    } finally {
      setSavingFb(false);
    }
  }

  async function handleRemoveFallback() {
    setSavingFb(true);
    beginMutation();
    try {
      const updated = await backend.removeFallback();
      // Clear the visible fallback fields even if the PUT only returns
      // `{ ok, fallbackConnected }` instead of a whole settings view.
      mergeSettings({
        fallbackConnected: false,
        fallbackEnabled: false,
        fallbackKeyLast4: null,
        ...updated,
      });
      setFbKey('');
      setFbEnabled(false);
      toast.success('Fallback removed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove fallback');
    } finally {
      setSavingFb(false);
    }
  }

  async function handleSaveProfile(profile: UserProfile) {
    setSavingProfile(true);
    beginMutation();
    try {
      const targets = await backend.saveProfile(profile);
      mergeSettings({ profile, targets });
      setEditingProfile(false);
      onProfileSaved?.();
      toast.success('Goal updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save profile');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    beginMutation();
    try {
      await backend.deleteAccount();
      setConfirmDelete(false);
      setApiKey('');
      // The account is gone; read the fresh (anonymous) settings so the screen
      // keeps rendering instead of falling back to its loading state.
      try {
        commitSettings(await backend.getSettings());
      } catch {
        // Keep the last settings on screen if the refresh fails.
      }
      toast.success('Account deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete account');
    } finally {
      setDeleting(false);
    }
  }

  function hydrateReminders(s: SettingsView) {
    const times = { ...DEFAULT_REMINDER_TIMES };
    const on: Record<string, boolean> = { breakfast: false, lunch: false, dinner: false };
    const saved = s.reminders?.times ?? {};
    for (const [label, time] of Object.entries(saved)) {
      times[label] = time;
      on[label] = true;
    }
    // Both the editable draft AND the committed snapshot start equal to server.
    setReminderTimes(times);
    setSlotOn(on);
    setSavedTimes(times);
    setSavedSlotOn(on);

    const anyOn = Object.values(on).some(Boolean);
    const deviceTz = new Date().getTimezoneOffset();
    if (anyOn && s.reminders && s.reminders.tzOffsetMinutes !== deviceTz) {
      // Silent self-heal: re-save the same enabled slots so the Worker gets the
      // current offset. No toast — the user didn't do anything. It is still a
      // mutation, so it must rewrite the settings cache: a silent PUT plus a
      // warm cache would repaint the old timezone on the next mount.
      const enabledTimes = Object.fromEntries(Object.entries(times).filter(([label]) => on[label]));
      backend
        .saveReminders(true, enabledTimes)
        .then((updated) => {
          const prev = getCached<SettingsView>(cacheKey.settings());
          if (prev && updated.reminders) {
            mutateCached(cacheKey.settings(), { ...prev, reminders: updated.reminders });
          }
        })
        .catch(() => {
          /* best-effort; will retry next app open */
        });
    }
  }

  // Unsaved-changes detector: compares the editable draft to the last committed
  // snapshot (a slot's time only counts when the slot is enabled).
  const remindersDirty =
    (['breakfast', 'lunch', 'dinner'] as const).some(
      (l) => Boolean(slotOn[l]) !== Boolean(savedSlotOn[l]),
    ) ||
    (['breakfast', 'lunch', 'dinner'] as const).some(
      (l) => slotOn[l] && reminderTimes[l] !== savedTimes[l],
    );

  /** Commits the current draft (enabled slots' times) to the backend. */
  async function saveReminders() {
    const enabledTimes = Object.fromEntries(
      Object.entries(reminderTimes).filter(([l]) => slotOn[l]),
    );
    const anyOn = Object.keys(enabledTimes).length > 0;
    setSavingReminders(true);
    beginMutation();
    try {
      const updated = await backend.saveReminders(anyOn, enabledTimes);
      mergeSettings({
        reminders: updated.reminders ?? {
          enabled: anyOn,
          times: enabledTimes,
          tzOffsetMinutes: new Date().getTimezoneOffset(),
        },
      });
      // Advance the committed snapshot so the button goes clean.
      setSavedTimes({ ...reminderTimes });
      setSavedSlotOn({ ...slotOn });
      toast.success('Reminders saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save reminders');
    } finally {
      setSavingReminders(false);
    }
  }

  // Toggles and time edits only touch local draft state — no network call per
  // change (that caused the time-picker lag). The "Save changes" button commits.
  function handleToggleSlot(label: string, on: boolean) {
    setSlotOn((prev) => ({ ...prev, [label]: on }));
  }

  /** Opts in/out of adaptive targets (persists immediately). */
  async function toggleAdaptive(on: boolean) {
    beginMutation();
    setAdaptiveOn(on);
    setSavingAdaptive(true);
    try {
      const updated = await backend.saveAdaptive(on);
      // The response may be only `{ ok, adaptive }`; patch just that field so
      // profile, reminders and fallback stay intact, and rewrite the cache.
      const adaptive = {
        enabled: updated.adaptive?.enabled ?? on,
        tzOffsetMinutes:
          updated.adaptive?.tzOffsetMinutes ??
          settingsRef.current?.adaptive?.tzOffsetMinutes ??
          new Date().getTimezoneOffset(),
      };
      mergeSettings({ adaptive });
      setAdaptiveOn(adaptive.enabled);
      toast.success(adaptive.enabled ? 'Adaptive targets on' : 'Adaptive targets off');
    } catch (e) {
      setAdaptiveOn(!on); // revert on failure
      toast.error(e instanceof Error ? e.message : 'Could not update adaptive targets');
    } finally {
      setSavingAdaptive(false);
    }
  }

  /** Records a bodyweight check-in from the input (accepts kg; strips a unit). */
  async function submitWeight() {
    const kg = Number.parseFloat(weightInput.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(kg) || kg < 25 || kg > 400) {
      setWeightError('Enter a weight in kg (25–400).');
      return;
    }
    setWeightError('');
    setSavingWeight(true);
    beginMutation();
    try {
      const updated = await backend.logWeight(kg);
      const latestWeightKg = updated.latestWeightKg ?? kg;
      mergeSettings({ latestWeightKg });
      setLatestWeightKg(latestWeightKg);
      setWeightInput('');
      toast.success('Weight logged');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not log weight');
    } finally {
      setSavingWeight(false);
    }
  }

  function handleReminderTimeChange(label: string, value: string) {
    // Snap to the nearest 15-min slot: the cron only checks every 15 min, so
    // picking 08:07 would silently behave like 08:15. Snapping keeps what the
    // user sees and what actually fires in sync. Native/mobile time pickers
    // allow any minute regardless of `step`, so this is the real guard.
    setReminderTimes((prev) => ({ ...prev, [label]: snapToReminderStep(value) }));
  }

  async function handleSendFeedback() {
    const message = feedbackText.trim();
    if (!message) {
      feedbackRef.current?.focus();
      return;
    }
    setSendingFeedback(true);
    try {
      await backend.sendFeedback(message);
      setFeedbackText('');
      setFeedbackOpen(false);
      toast.success('Feedback sent. Thank you.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send feedback');
    } finally {
      setSendingFeedback(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-title">Settings</h1>

      {loadFailed && (
        <p role="alert" className="text-destructive text-caption">
          Could not load settings. Check the connection and open Settings again.
        </p>
      )}

      {!loadFailed && loading && (
        <div className="flex flex-col gap-5">
          {GROUPS.map((group) => (
            <div key={group} className="flex flex-col gap-4">
              <h2 className="text-muted-foreground text-caption font-medium">{group}</h2>
              <Skeleton className="h-24 w-full rounded-control" />
            </div>
          ))}
        </div>
      )}

      {!loadFailed && !loading && settings && (
        <>
          <div className="flex flex-col gap-4">
            <h2 className="text-muted-foreground text-caption font-medium">Today’s targets</h2>

            <Section title="Goal and targets" level={3}>
              {editingProfile ? (
                <ProfileForm
                  initial={settings.profile ?? null}
                  submitLabel="Save goal"
                  saving={savingProfile}
                  onSubmit={handleSaveProfile}
                />
              ) : settings.profile && settings.targets ? (
                <>
                  <p className="text-muted-foreground text-caption">
                    {GOAL_LABELS[settings.profile.goal]} · {settings.profile.sex},{' '}
                    {profileAge(settings.profile)}y
                  </p>
                  <MacroLine
                    energyKcal={settings.targets.energyKcal}
                    proteinG={settings.targets.proteinG}
                    carbsG={settings.targets.carbsG}
                    fatG={settings.targets.fatG}
                  />
                  <Button variant="secondary" onClick={() => setEditingProfile(true)}>
                    Edit goal
                  </Button>
                </>
              ) : (
                <Button onClick={() => setEditingProfile(true)}>Set your goal</Button>
              )}
            </Section>

            <Section title="Meal reminders" level={3}>
              <p className="text-muted-foreground text-caption">
                Once per slot, in your device’s timezone. Times snap to the nearest{' '}
                {REMINDER_STEP_MINUTES} minutes.
              </p>
              {!isLocal && <PushReminders push={settings.push} />}
              <div className="flex flex-col gap-2">
                {(['breakfast', 'lunch', 'dinner'] as const).map((label) => (
                  <div key={label} className="flex items-center gap-3">
                    <Label htmlFor={`reminder-${label}`} className="min-w-0 flex-1 capitalize">
                      {label}
                    </Label>
                    <Input
                      id={`reminder-${label}`}
                      type="time"
                      // Reminders are checked by a 15-min cron, so only :00/:15/:30/:45
                      // are meaningful. step=900s hints native pickers to 15-min
                      // increments; onBlur snaps whatever was chosen to the grid.
                      step={REMINDER_STEP_MINUTES * 60}
                      className="w-28 shrink-0"
                      value={reminderTimes[label] ?? DEFAULT_REMINDER_TIMES[label]}
                      disabled={savingReminders || !slotOn[label]}
                      onChange={(e) => handleReminderTimeChange(label, e.target.value)}
                      onBlur={(e) => handleReminderTimeChange(label, e.target.value)}
                    />
                    <Switch
                      aria-label={`Enable ${label} reminder`}
                      checked={Boolean(slotOn[label])}
                      disabled={savingReminders}
                      onCheckedChange={(on) => handleToggleSlot(label, on)}
                    />
                  </div>
                ))}
              </div>
              {remindersDirty && (
                <Button disabled={savingReminders} onClick={() => void saveReminders()}>
                  {savingReminders ? 'Saving…' : 'Save changes'}
                </Button>
              )}
            </Section>

            <Section title="Adaptive targets" level={3}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-body font-medium">Use adaptive targets</span>
                <Switch
                  aria-label="Enable adaptive targets"
                  checked={adaptiveOn}
                  disabled={savingAdaptive}
                  onCheckedChange={(on) => void toggleAdaptive(on)}
                />
              </div>
              <p className="text-muted-foreground text-caption">
                Log your weight weekly. SnapBite adjusts your calorie goal once a week from your
                weight trend, and the goal stays editable.
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="weight-input">Log weight (kg)</Label>
                <div className="flex items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Input
                      id="weight-input"
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      placeholder={latestWeightKg != null ? String(latestWeightKg) : 'e.g. 72.5'}
                      value={weightInput}
                      disabled={savingWeight}
                      aria-invalid={weightError ? true : undefined}
                      aria-describedby={weightError ? 'weight-error' : undefined}
                      onChange={(e) => {
                        setWeightInput(e.target.value);
                        if (weightError) setWeightError('');
                      }}
                    />
                    {weightError && (
                      <p id="weight-error" className="text-destructive text-caption">
                        {weightError}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    disabled={savingWeight}
                    onClick={() => void submitWeight()}
                  >
                    {savingWeight ? 'Saving…' : 'Log weight'}
                  </Button>
                </div>
              </div>
              {latestWeightKg != null && (
                <p className="text-muted-foreground text-caption">
                  Last logged: {latestWeightKg} kg
                </p>
              )}
            </Section>

            <Section title="Weekly view" level={3}>
              <div className="flex flex-col gap-1.5">
                <Label>Week is</Label>
                <ToggleGroup
                  type="single"
                  value={weekPrefs.mode}
                  onValueChange={(v) => v && updateWeekPrefs({ mode: v as WeekMode })}
                  block
                  aria-label="How a week is counted"
                >
                  <ToggleGroupItem value="rolling">Last 7 days</ToggleGroupItem>
                  <ToggleGroupItem value="calendar">Calendar week</ToggleGroupItem>
                </ToggleGroup>
                <p className="text-muted-foreground text-caption">
                  {weekPrefs.mode === 'rolling'
                    ? 'Today and the previous 6 days.'
                    : 'The calendar week that contains the selected day.'}
                </p>
              </div>

              {weekPrefs.mode === 'calendar' && (
                <div className="flex flex-col gap-1.5">
                  <Label>Week starts on</Label>
                  <ToggleGroup
                    type="single"
                    value={weekPrefs.weekStart}
                    onValueChange={(v) => v && updateWeekPrefs({ weekStart: v as WeekStart })}
                    block
                    aria-label="Week starts on"
                  >
                    <ToggleGroupItem value="monday">Monday</ToggleGroupItem>
                    <ToggleGroupItem value="sunday">Sunday</ToggleGroupItem>
                  </ToggleGroup>
                </div>
              )}
            </Section>
          </div>

          <div className="flex flex-col gap-4">
            <h2 className="text-muted-foreground text-caption font-medium">Logging and AI</h2>

            {isLocal ? (
              <Section title="AI key" level={3}>
                <p className="text-muted-foreground text-caption">
                  Demo mode: meals are analyzed by a demo model, so no key is needed.
                </p>
              </Section>
            ) : (
              <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
                <h3 aria-label="AI key" className="text-body font-medium">
                  <button
                    type="button"
                    aria-expanded={aiKeyExpanded}
                    aria-controls={aiKeyPanelId}
                    onClick={() => setAiKeyExpanded(!aiKeyExpanded)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 text-left font-medium transition-[background-color,transform] duration-[120ms] active:scale-[0.97] active:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:active:scale-100"
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span>AI key</span>
                      {!aiKeyExpanded && (
                        <span className="text-muted-foreground text-caption truncate">
                          {providerSummary(settings)}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {!aiKeyExpanded &&
                        (primaryConnected ? (
                          <span className="flex items-center gap-1 text-caption font-medium">
                            <CheckCircle2 className="size-4" />
                            Connected
                          </span>
                        ) : (
                          <span className="text-destructive text-caption font-medium">
                            Not connected
                          </span>
                        ))}
                      <ChevronDown
                        aria-hidden
                        className="text-muted-foreground size-4 shrink-0 transition-transform duration-200 ease-[var(--ease-out-quint)] motion-reduce:transition-none"
                        style={{ transform: aiKeyExpanded ? 'rotate(180deg)' : 'none' }}
                      />
                    </span>
                  </button>
                </h3>

                {aiKeyExpanded && (
                  <div id={aiKeyPanelId} className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-body font-medium">Status</span>
                      {settings.connected ? (
                        <span className="flex items-center gap-1 text-caption font-medium">
                          <CheckCircle2 className="size-4" />
                          Connected
                        </span>
                      ) : (
                        <span className="text-destructive text-caption font-medium">
                          Not connected
                        </span>
                      )}
                    </div>

                    <ProviderPicker
                      idPrefix="primary"
                      value={primaryCfg}
                      onChange={setPrimaryCfg}
                    />

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="apikey">API key</Label>
                      <Input
                        id="apikey"
                        ref={apiKeyRef}
                        type="password"
                        autoComplete="off"
                        placeholder="paste your key"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                      />
                      {primaryCfg.provider !== 'custom' && (
                        <LinkifiedHint
                          text={PROVIDER_PRESETS[primaryCfg.provider].keyHint}
                          className="text-muted-foreground text-caption"
                        />
                      )}
                    </div>

                    {primaryCfg.provider !== 'custom' && (
                      <KeyGuide provider={primaryCfg.provider} />
                    )}

                    <Button disabled={saving} onClick={handleSave}>
                      {saving ? 'Saving…' : 'Save key'}
                    </Button>
                    <p className="text-muted-foreground text-caption">
                      Your key is sent over HTTPS, encrypted on SnapBite&apos;s servers, and never
                      shown again or logged.
                    </p>
                    <p className="text-muted-foreground text-caption">
                      Free keys stop at about 20 requests a day and return a &ldquo;quota
                      exceeded&rdquo; error. Add billing, or set a fallback below.
                    </p>
                  </div>
                )}
              </section>
            )}

            {!isLocal && (
              <Section title="Fallback provider" level={3}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-body font-medium">Use a fallback provider</span>
                    <span className="text-muted-foreground text-caption">
                      {!primaryConnected
                        ? 'Connect your main provider first'
                        : settings.fallbackConnected
                          ? `${settings.fallbackProvider}${settings.fallbackKeyLast4 ? ` · …${settings.fallbackKeyLast4}` : ''}${settings.fallbackEnabled ? '' : ' · saved (off)'}`
                          : 'Off'}
                    </span>
                  </div>
                  <Switch
                    aria-label="Enable fallback provider"
                    checked={fbEnabled}
                    disabled={!primaryConnected || savingFb}
                    onCheckedChange={handleToggleFallback}
                  />
                </div>

                {/* Always-visible "why" so users understand the benefit before enabling. */}
                <p className="text-muted-foreground text-caption">
                  Free AI tiers get busy. Your provider can hit a rate limit, be overloaded, or run
                  out of credit, and a photo won&apos;t log. Add a second provider and SnapBite
                  switches to it when that happens.
                </p>

                <Collapsible open={fbEnabled && primaryConnected}>
                  <div className="flex flex-col gap-3 pt-1">
                    <p className="text-muted-foreground text-caption">
                      OpenAI (gpt-4o-mini) is recommended.
                    </p>

                    <ProviderPicker idPrefix="fb" value={fbCfg} onChange={setFbCfg} />

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="fb-key">Fallback API key</Label>
                      <Input
                        id="fb-key"
                        ref={fbKeyRef}
                        type="password"
                        autoComplete="off"
                        placeholder={
                          settings.fallbackConnected
                            ? 'Saved. Paste a new key to replace it.'
                            : 'paste your fallback key'
                        }
                        value={fbKey}
                        onChange={(e) => setFbKey(e.target.value)}
                      />
                      {fbCfg.provider !== 'custom' && (
                        <LinkifiedHint
                          text={PROVIDER_PRESETS[fbCfg.provider].keyHint}
                          className="text-muted-foreground text-caption"
                        />
                      )}
                    </div>

                    {fbCfg.provider !== 'custom' && <KeyGuide provider={fbCfg.provider} />}

                    <Button variant="secondary" disabled={savingFb} onClick={handleSaveFallback}>
                      {savingFb ? 'Saving…' : 'Save fallback'}
                    </Button>
                    {settings.fallbackConnected && (
                      <Button
                        variant="link"
                        className="w-full"
                        disabled={savingFb}
                        onClick={handleRemoveFallback}
                      >
                        Remove fallback
                      </Button>
                    )}
                  </div>
                </Collapsible>
              </Section>
            )}
          </div>

          {!isLocal && (
            <div className="flex flex-col gap-4">
              <h2 className="text-muted-foreground text-caption font-medium">One-tap logging</h2>
              <ShortcutCard backend={backend} />
            </div>
          )}

          <div className="flex flex-col gap-4">
            <h2 className="text-muted-foreground text-caption font-medium">Account and data</h2>

            {!isLocal && (
              <Section title="Account" level={3}>
                <AccountCard onSignedIn={() => setAccountVersion((version) => version + 1)} />
              </Section>
            )}

            {/* Paid features need a verified identity, so this is worker-only. */}
            {!isLocal && (
              <Section title="Credits and supporter" level={3}>
                <CreditsCard backend={backend} refreshSignal={accountVersion} />
              </Section>
            )}

            <Section title="Privacy and your data" level={3}>
              <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-caption">
                <li>SnapBite stores your logged meals: foods, nutrition, notes, and timestamps.</li>
                <li>
                  Meal photos are only kept for meals you send to the Telegram bot, and are served
                  back only to you.
                </li>
                <li>
                  Your AI API key is encrypted on SnapBite&apos;s servers and never included in
                  exports or logs.
                </li>
              </ul>

              <ExportData backend={backend} />
              <Button
                variant="link"
                className="text-destructive w-full"
                onClick={() => setConfirmDelete(true)}
              >
                Delete account
              </Button>
            </Section>

            <Section title="Feedback and support" level={3}>
              <Button variant="secondary" onClick={() => setFeedbackOpen(true)}>
                Send feedback
              </Button>
            </Section>
          </div>
        </>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes all your meals, photos, and settings. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="destructive" disabled={deleting} onClick={handleDeleteAccount}>
              {deleting ? 'Deleting…' : 'Delete everything'}
            </Button>
            <Button variant="secondary" disabled={deleting} onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>
              Say what went wrong or what should be better. This goes straight to the maintainer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="feedback">Feedback</Label>
            <Textarea
              id="feedback"
              ref={feedbackRef}
              placeholder="e.g. the analysis was off for my salad, or I'd love a weekly summary…"
              maxLength={FEEDBACK_MAX_LEN}
              rows={5}
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
            />
            <p className="text-muted-foreground text-caption text-right">
              {feedbackText.length}/{FEEDBACK_MAX_LEN}
            </p>
          </div>
          <DialogActions>
            <Button className="h-12" disabled={sendingFeedback} onClick={handleSendFeedback}>
              {sendingFeedback ? 'Sending…' : 'Send feedback'}
            </Button>
            <Button
              variant="link"
              className="w-full"
              disabled={sendingFeedback}
              onClick={() => setFeedbackOpen(false)}
            >
              Cancel
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
}
