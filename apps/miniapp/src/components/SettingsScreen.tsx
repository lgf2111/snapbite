import {
  DEFAULT_REMINDER_TIMES,
  FEEDBACK_MAX_LEN,
  PROVIDER_PRESETS,
  profileAge,
  type ProviderId,
  type UserProfile,
} from '@snapbite/core';
import { type ProviderConfig, ProviderPicker } from './ProviderPicker.js';
import {
  Bell,
  CheckCircle2,
  Download,
  MessageSquare,
  Pencil,
  ShieldCheck,
  Target,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import type { SettingsView } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import { downloadViaTelegram, openExportUrl } from '@/lib/telegram';
import { InfoDisclosure } from './InfoDisclosure.js';
import { MacroLine } from './MacroLine.js';
import { ProfileForm } from './ProfileForm.js';

interface SettingsScreenProps {
  backend: Backend;
  /** Called after the profile is saved, so the app can refresh Home targets. */
  onProfileSaved?: () => void;
}

const GOAL_LABEL: Record<string, string> = { lose: 'Lose weight', maintain: 'Maintain', gain: 'Gain' };

const PROVIDERS = Object.values(PROVIDER_PRESETS);

/** Human label for a stored provider id (incl. 'custom'). */
function providerLabel(id: string): string {
  if (id === 'custom') return 'Custom';
  return id === 'gemini' || id === 'openai' || id === 'deepseek'
    ? PROVIDER_PRESETS[id].label
    : id;
}

/** Builds a ProviderConfig from stored settings fields. */
function cfgFromSettings(
  provider: string | null | undefined,
  model: string | null | undefined,
  baseUrl: string | null | undefined,
  supportsDetail: boolean | undefined,
): ProviderConfig {
  const isPreset = provider === 'gemini' || provider === 'openai' || provider === 'deepseek';
  const p: ProviderConfig['provider'] = isPreset ? provider : provider === 'custom' ? 'custom' : 'gemini';
  return {
    provider: p,
    model: model ?? (p === 'custom' ? '' : PROVIDER_PRESETS[p].defaultModel),
    baseUrl: baseUrl ?? '',
    supportsDetail: Boolean(supportsDetail),
  };
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
      <a
        href={guide.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline"
      >
        Open {new URL(guide.url).host} ↗
      </a>
    </InfoDisclosure>
  );
}

export function SettingsScreen({ backend, onProfileSaved }: SettingsScreenProps) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [primaryCfg, setPrimaryCfg] = useState<ProviderConfig>({
    provider: 'gemini',
    model: PROVIDER_PRESETS.gemini.defaultModel,
    baseUrl: '',
    supportsDetail: false,
  });
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [sendingFeedback, setSendingFeedback] = useState(false);
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
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [fbCfg, setFbCfg] = useState<ProviderConfig>({
    provider: 'openai',
    model: PROVIDER_PRESETS.openai.defaultModel,
    baseUrl: '',
    supportsDetail: false,
  });
  const [fbKey, setFbKey] = useState('');
  const [savingFb, setSavingFb] = useState(false);
  const [fbEnabled, setFbEnabled] = useState(false);

  useEffect(() => {
    backend
      .getSettings()
      .then((s) => {
        setSettings(s);
        setPrimaryCfg(cfgFromSettings(s.aiProvider, s.aiModel, s.customBaseUrl, s.customSupportsDetail));
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
        hydrateReminders(s);
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed to load settings'));
  }, [backend]);

  const isLocal = backend.mode === 'local';
  const primaryConnected = Boolean(settings?.connected);

  async function handleToggleFallback(on: boolean) {
    setFbEnabled(on);
    // Toggling only flips enabled — the stored key is KEPT so the user can
    // re-enable without re-entering it. (An unsaved draft just expands/collapses.)
    if (settings?.fallbackConnected) {
      setSavingFb(true);
      try {
        const updated = await backend.setFallbackEnabled(on);
        setSettings(updated);
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
    if (!key) return;
    if (primaryCfg.provider === 'custom' && !/^https:\/\/.+/i.test(primaryCfg.baseUrl.trim())) {
      toast.error('Enter a valid https base URL for the custom provider');
      return;
    }
    setSaving(true);
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
      setSettings(updated);
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
    if (!key) return;
    if (fbCfg.provider === 'custom' && !/^https:\/\/.+/i.test(fbCfg.baseUrl.trim())) {
      toast.error('Enter a valid https base URL for the custom provider');
      return;
    }
    setSavingFb(true);
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
      setSettings(updated);
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
    try {
      const updated = await backend.removeFallback();
      setSettings(updated);
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
    try {
      const targets = await backend.saveProfile(profile);
      setSettings((s) => (s ? { ...s, profile, targets } : s));
      setEditingProfile(false);
      onProfileSaved?.();
      toast.success('Goal updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save profile');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleExport() {
    const fileName = `foodlog-export-${new Date().toISOString().slice(0, 10)}.json`;
    const url = backend.exportUrl();

    // Worker mode: the export has a public, auth-carrying HTTPS URL. Blob
    // downloads don't work inside Telegram's webview (they strand a blob: URL
    // that Safari can't open), so hand a real URL off to the platform. Do this
    // synchronously in the click handler so Telegram's openLink keeps its
    // required user-gesture. The response's attachment header makes the
    // browser save it as a file.
    if (url) {
      // 1) Native file download prompt (Mini Apps v8+, mainly iOS/Android).
      if (downloadViaTelegram(url, fileName)) {
        toast.success('Downloading export…');
        return;
      }
      // 2) Open the public URL — Telegram's openLink if present, else the
      //    webview's own window.open, both of which reach a real HTTPS URL.
      openExportUrl(url);
      toast.success('Opening export…');
      return;
    }

    // Local demo (no backend): build the JSON client-side and download a blob.
    setExporting(true);
    try {
      const data = await backend.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success('Export downloaded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not export data');
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      await backend.deleteAccount();
      setConfirmDelete(false);
      setSettings(null);
      setApiKey('');
      toast.success('Account deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete account');
    } finally {
      setDeleting(false);
    }
  }

  // Reads reminder state from a settings payload into slot toggles + times, and
  // opportunistically refreshes the stored timezone offset if the device moved
  // (so travel/DST self-heals on app open without the user re-saving).
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
      // current offset. No toast — the user didn't do anything.
      const enabledTimes = Object.fromEntries(
        Object.entries(times).filter(([label]) => on[label]),
      );
      backend.saveReminders(true, enabledTimes).catch(() => {
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
    try {
      const updated = await backend.saveReminders(anyOn, enabledTimes);
      setSettings(updated);
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

  function handleReminderTimeChange(label: string, value: string) {
    setReminderTimes((prev) => ({ ...prev, [label]: value }));
  }

  async function handleSendFeedback() {
    const message = feedbackText.trim();
    if (!message) return;
    setSendingFeedback(true);
    try {
      await backend.sendFeedback(message);
      setFeedbackText('');
      setFeedbackOpen(false);
      toast.success('Thanks — your feedback was sent.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send feedback');
    } finally {
      setSendingFeedback(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Target className="text-primary size-5" />
            <span className="font-medium">Your goal &amp; targets</span>
          </div>

          {editingProfile ? (
            <ProfileForm
              initial={settings?.profile ?? null}
              submitLabel="Save goal"
              saving={savingProfile}
              onSubmit={handleSaveProfile}
            />
          ) : settings?.profile && settings?.targets ? (
            <>
              <p className="text-muted-foreground text-sm">
                {GOAL_LABEL[settings.profile.goal] ?? settings.profile.goal} ·{' '}
                {settings.profile.sex}, {profileAge(settings.profile)}y
              </p>
              <MacroLine
                energyKcal={settings.targets.energyKcal}
                proteinG={settings.targets.proteinG}
                carbsG={settings.targets.carbsG}
                fatG={settings.targets.fatG}
              />
              <Button variant="secondary" className="gap-2" onClick={() => setEditingProfile(true)}>
                <Pencil className="size-4" /> Edit goal
              </Button>
            </>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">
                Set your details and goal to get daily calorie and macro targets.
              </p>
              <Button onClick={() => setEditingProfile(true)}>Set your goal</Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Bell className="text-primary size-5" />
            <span className="font-medium">Meal reminders</span>
          </div>
          <p className="text-muted-foreground text-xs">
            A daily Telegram nudge to log each meal. Toggle the ones you want and set their times —
            you'll be reminded once per slot per day, in your device's timezone.
          </p>
          <div className="flex flex-col gap-2 pt-1">
            {(['breakfast', 'lunch', 'dinner'] as const).map((label) => (
              <div key={label} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    aria-label={`Enable ${label} reminder`}
                    checked={Boolean(slotOn[label])}
                    disabled={savingReminders}
                    onCheckedChange={(on) => handleToggleSlot(label, on)}
                  />
                  <Label htmlFor={`reminder-${label}`} className="capitalize">
                    {label}
                  </Label>
                </div>
                <Input
                  id={`reminder-${label}`}
                  type="time"
                  className="w-32"
                  value={reminderTimes[label] ?? DEFAULT_REMINDER_TIMES[label]}
                  disabled={savingReminders || !slotOn[label]}
                  onChange={(e) => handleReminderTimeChange(label, e.target.value)}
                />
              </div>
            ))}
          </div>
          {remindersDirty && (
            <Button
              className="mt-1"
              disabled={savingReminders}
              onClick={() => void saveReminders()}
            >
              {savingReminders ? 'Saving…' : 'Save changes'}
            </Button>
          )}
        </CardContent>
      </Card>

      {isLocal ? (
        <Card>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Running in demo mode with a mock analyzer — no API key needed.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex items-center justify-between">
              <span className="font-medium">Status</span>
              {settings?.connected ? (
                <span className="text-primary flex items-center gap-1 text-sm">
                  <CheckCircle2 className="size-4" />
                  {providerLabel(settings.aiProvider)}
                  {settings.keyLast4 ? ` · …${settings.keyLast4}` : ''}
                </span>
              ) : (
                <span className="text-destructive text-sm">Not connected</span>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3">
              <ProviderPicker idPrefix="primary" value={primaryCfg} onChange={setPrimaryCfg} />

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="apikey">API key</Label>
                <Input
                  id="apikey"
                  type="password"
                  autoComplete="off"
                  placeholder="paste your key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                {primaryCfg.provider !== 'custom' && (
                  <p className="text-muted-foreground text-xs">
                    {PROVIDER_PRESETS[primaryCfg.provider].keyHint}
                  </p>
                )}
              </div>

              {primaryCfg.provider !== 'custom' && <KeyGuide provider={primaryCfg.provider} />}

              <Button disabled={!apiKey.trim() || saving} onClick={handleSave}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <p className="text-muted-foreground text-xs">
                Your key is sent over HTTPS, encrypted at rest, and never shown again or logged.
              </p>
              <p className="text-muted-foreground text-xs">
                Heads up: free tiers have limits — Gemini's free tier allows about 20 requests/day
                on <code>gemini-3.6-flash</code> plus a per-minute cap, and returns a "quota
                exceeded" error once hit. Add billing to your key, or set a fallback below.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col">
                  <span className="font-medium">Fallback provider</span>
                  <span className="text-muted-foreground text-xs">
                    {!primaryConnected
                      ? 'Connect your main provider first'
                      : settings?.fallbackConnected
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
              <p className="text-muted-foreground text-xs">
                Free AI tiers get busy — your provider can hit a rate limit, be temporarily
                overloaded, or run out of credit, and a photo won't log. Add a second provider here
                and SnapBite switches to it automatically when that happens, so your meals keep
                logging without you resending the photo.
              </p>

              <Collapsible open={fbEnabled && primaryConnected}>
                <div className="flex flex-col gap-3 pt-1">
                  <p className="text-muted-foreground text-xs">
                    If your main provider hits a rate limit or is overloaded, SnapBite retries the
                    photo with this provider automatically. OpenAI (gpt-4o-mini) is recommended —
                    it's the most accurate at food recognition.
                  </p>

                  <ProviderPicker idPrefix="fb" value={fbCfg} onChange={setFbCfg} />

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="fb-key">Fallback API key</Label>
                    <Input
                      id="fb-key"
                      type="password"
                      autoComplete="off"
                      placeholder={
                        settings?.fallbackConnected ? 'saved — paste to replace' : 'paste your fallback key'
                      }
                      value={fbKey}
                      onChange={(e) => setFbKey(e.target.value)}
                    />
                    {fbCfg.provider !== 'custom' && (
                      <p className="text-muted-foreground text-xs">
                        {PROVIDER_PRESETS[fbCfg.provider].keyHint}
                      </p>
                    )}
                  </div>

                  {fbCfg.provider !== 'custom' && <KeyGuide provider={fbCfg.provider} />}

                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      disabled={!fbKey.trim() || savingFb}
                      onClick={handleSaveFallback}
                    >
                      {savingFb ? 'Saving…' : settings?.fallbackConnected ? 'Replace key' : 'Save fallback'}
                    </Button>
                    {settings?.fallbackConnected && (
                      <Button variant="secondary" disabled={savingFb} onClick={handleRemoveFallback}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </Collapsible>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-primary size-5" />
            <span className="font-medium">Privacy &amp; your data</span>
          </div>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
            <li>We store your logged meals: foods, nutrition, notes, and timestamps.</li>
            <li>
              Meal photos are only kept for meals you send to the Telegram bot, and are served
              back only to you.
            </li>
            <li>Your AI API key is encrypted at rest and never included in exports or logs.</li>
            <li>You can export everything or delete your account at any time below.</li>
          </ul>

          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Button
              variant="secondary"
              className="gap-2"
              disabled={exporting}
              onClick={handleExport}
            >
              <Download className="size-4" />
              {exporting ? 'Exporting…' : 'Export my data'}
            </Button>
            <Button
              variant="destructive"
              className="gap-2"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4" />
              Delete account
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="text-primary size-5" />
            <span className="font-medium">Feedback &amp; support</span>
          </div>
          <p className="text-muted-foreground text-sm">
            Hit a problem or have an idea? Send it straight to the maintainer.
          </p>
          <Button variant="secondary" className="gap-2" onClick={() => setFeedbackOpen(true)}>
            <MessageSquare className="size-4" /> Send feedback
          </Button>
        </CardContent>
      </Card>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes all your meals, photos, and settings. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" disabled={deleting} onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={handleDeleteAccount}>
              {deleting ? 'Deleting…' : 'Delete everything'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>
              Tell us what went wrong or what you'd like improved. This goes straight to the
              maintainer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Textarea
              aria-label="Your feedback"
              placeholder="e.g. the analysis was off for my salad, or I'd love a weekly summary…"
              maxLength={FEEDBACK_MAX_LEN}
              rows={5}
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
            />
            <p className="text-muted-foreground text-right text-xs">
              {feedbackText.length}/{FEEDBACK_MAX_LEN}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={sendingFeedback}
              onClick={() => setFeedbackOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={!feedbackText.trim() || sendingFeedback} onClick={handleSendFeedback}>
              {sendingFeedback ? 'Sending…' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
