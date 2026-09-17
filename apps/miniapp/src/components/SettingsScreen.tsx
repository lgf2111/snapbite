import { PROVIDER_PRESETS, type ProviderId, type UserProfile } from '@foodlog/core';
import { CheckCircle2, Download, Pencil, ShieldCheck, Target, Trash2 } from 'lucide-react';
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
import { Collapsible } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import type { SettingsView } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import { downloadViaTelegram, openExportUrl } from '@/lib/telegram';
import { MacroLine } from './MacroLine.js';
import { ProfileForm } from './ProfileForm.js';

interface SettingsScreenProps {
  backend: Backend;
  /** Called after the profile is saved, so the app can refresh Home targets. */
  onProfileSaved?: () => void;
}

const GOAL_LABEL: Record<string, string> = { lose: 'Lose weight', maintain: 'Maintain', gain: 'Gain' };

const PROVIDERS = Object.values(PROVIDER_PRESETS);

export function SettingsScreen({ backend, onProfileSaved }: SettingsScreenProps) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [provider, setProvider] = useState<ProviderId>('gemini');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [fbProvider, setFbProvider] = useState<ProviderId>('openai');
  const [fbModel, setFbModel] = useState('');
  const [fbKey, setFbKey] = useState('');
  const [savingFb, setSavingFb] = useState(false);
  const [fbEnabled, setFbEnabled] = useState(false);

  useEffect(() => {
    backend
      .getSettings()
      .then((s) => {
        setSettings(s);
        if (s.aiProvider === 'gemini' || s.aiProvider === 'openai' || s.aiProvider === 'deepseek') {
          setProvider(s.aiProvider);
        }
        if (s.aiModel) setModel(s.aiModel);
        if (
          s.fallbackProvider === 'gemini' ||
          s.fallbackProvider === 'openai' ||
          s.fallbackProvider === 'deepseek'
        ) {
          setFbProvider(s.fallbackProvider);
        }
        if (s.fallbackModel) setFbModel(s.fallbackModel);
        if (s.fallbackConnected) setFbEnabled(true);
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed to load settings'));
  }, [backend]);

  const preset = PROVIDER_PRESETS[provider];
  const isLocal = backend.mode === 'local';
  const primaryConnected = Boolean(settings?.connected);

  function handleToggleFallback(on: boolean) {
    setFbEnabled(on);
    // Turning off with a saved fallback clears it; turning off an unsaved draft
    // just collapses the section.
    if (!on && settings?.fallbackConnected) void handleClearFallback();
  }

  async function handleSave() {
    const key = apiKey.trim();
    if (!key) return;
    setSaving(true);
    try {
      const updated = await backend.saveApiKey(key, provider, model.trim() || undefined);
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
    setSavingFb(true);
    try {
      const updated = await backend.saveFallback(key, fbProvider, fbModel.trim() || undefined);
      setSettings(updated);
      setFbKey('');
      toast.success('Fallback saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save fallback');
    } finally {
      setSavingFb(false);
    }
  }

  async function handleClearFallback() {
    setSavingFb(true);
    try {
      const updated = await backend.saveFallback('');
      setSettings(updated);
      setFbKey('');
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
      setModel('');
      toast.success('Account deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete account');
    } finally {
      setDeleting(false);
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
                {settings.profile.sex}, {settings.profile.age}y
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
                  {settings.aiProvider}
                  {settings.keyLast4 ? ` · …${settings.keyLast4}` : ''}
                </span>
              ) : (
                <span className="text-destructive text-sm">Not connected</span>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="provider">AI provider</Label>
                <select
                  id="provider"
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value as ProviderId);
                    setModel('');
                  }}
                  className="border-input h-9 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="model">Model (optional)</Label>
                <Input
                  id="model"
                  placeholder={preset.defaultModel}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>

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
                <p className="text-muted-foreground text-xs">{preset.keyHint}</p>
              </div>

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
                    {settings?.fallbackConnected
                      ? `${settings.fallbackProvider}${settings.fallbackKeyLast4 ? ` · …${settings.fallbackKeyLast4}` : ''}`
                      : primaryConnected
                        ? 'Off'
                        : 'Connect your main provider first'}
                  </span>
                </div>
                <Switch
                  aria-label="Enable fallback provider"
                  checked={fbEnabled}
                  disabled={!primaryConnected || savingFb}
                  onCheckedChange={handleToggleFallback}
                />
              </div>

              <Collapsible open={fbEnabled && primaryConnected}>
                <div className="flex flex-col gap-3 pt-1">
                  <p className="text-muted-foreground text-xs">
                    If your main provider hits a rate limit or is overloaded, FoodLog retries the
                    photo with this provider automatically. OpenAI (gpt-4o-mini) is recommended —
                    it's the most accurate at food recognition.
                  </p>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="fb-provider">Provider</Label>
                    <select
                      id="fb-provider"
                      value={fbProvider}
                      onChange={(e) => {
                        setFbProvider(e.target.value as ProviderId);
                        setFbModel('');
                      }}
                      className="border-input h-9 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="fb-model">Model (optional)</Label>
                    <Input
                      id="fb-model"
                      placeholder={PROVIDER_PRESETS[fbProvider].defaultModel}
                      value={fbModel}
                      onChange={(e) => setFbModel(e.target.value)}
                    />
                  </div>

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
                    <p className="text-muted-foreground text-xs">
                      {PROVIDER_PRESETS[fbProvider].keyHint}
                    </p>
                  </div>

                  <Button
                    className="w-full"
                    disabled={!fbKey.trim() || savingFb}
                    onClick={handleSaveFallback}
                  >
                    {savingFb ? 'Saving…' : 'Save fallback'}
                  </Button>
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
    </div>
  );
}
