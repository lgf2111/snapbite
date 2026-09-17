import { PROVIDER_PRESETS, type ProviderId } from '@foodlog/core';
import { CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SettingsView } from '@/lib/api';
import type { Backend } from '@/lib/backend';

interface SettingsScreenProps {
  backend: Backend;
}

const PROVIDERS = Object.values(PROVIDER_PRESETS);

export function SettingsScreen({ backend }: SettingsScreenProps) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [provider, setProvider] = useState<ProviderId>('gemini');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    backend
      .getSettings()
      .then((s) => {
        setSettings(s);
        if (s.aiProvider === 'gemini' || s.aiProvider === 'openai' || s.aiProvider === 'deepseek') {
          setProvider(s.aiProvider);
        }
        if (s.aiModel) setModel(s.aiModel);
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed to load settings'));
  }, [backend]);

  const preset = PROVIDER_PRESETS[provider];
  const isLocal = backend.mode === 'local';

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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Settings</h1>

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
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
