import { PROVIDER_PRESETS, type ProviderId } from '@foodlog/core';
import { useEffect, useState } from 'react';
import type { SettingsView } from '../lib/api.js';
import type { Backend } from '../lib/backend.js';

interface SettingsScreenProps {
  backend: Backend;
}

const PROVIDERS = Object.values(PROVIDER_PRESETS);

/**
 * Settings: choose an AI provider + model and connect a BYOK key. The key is
 * sent over HTTPS and encrypted server-side; it's never shown back — only a
 * "Connected" status and last 4.
 */
export function SettingsScreen({ backend }: SettingsScreenProps) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [provider, setProvider] = useState<ProviderId>('gemini');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

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
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load settings'));
  }, [backend]);

  const preset = PROVIDER_PRESETS[provider];

  async function handleSave() {
    const key = apiKey.trim();
    if (!key) return;
    setStatus('saving');
    setError(null);
    try {
      const updated = await backend.saveApiKey(key, provider, model.trim() || undefined);
      setSettings(updated);
      setApiKey('');
      setStatus('saved');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Could not save key');
    }
  }

  const isLocal = backend.mode === 'local';
  const inputStyle = {
    width: '100%',
    padding: 12,
    borderRadius: 8,
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    marginBottom: 8,
  } as const;

  return (
    <div>
      <h1>Settings</h1>

      {isLocal ? (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            Running in demo mode with a mock analyzer — no API key needed. Connect a Worker backend
            to use a real AI provider.
          </p>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="header" style={{ marginBottom: 8 }}>
              <span className="food-name">Status</span>
              {settings?.connected ? (
                <span className="muted">
                  ✓ {settings.aiProvider}
                  {settings.keyLast4 ? ` · …${settings.keyLast4}` : ''}
                </span>
              ) : (
                <span className="warn">Not connected</span>
              )}
            </div>
            {!settings?.connected && (
              <p className="warn" style={{ margin: 0 }}>
                Add an API key below to analyze photos.
              </p>
            )}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <p className="muted" style={{ marginTop: 0 }}>
              AI provider
            </p>
            <select
              aria-label="AI provider"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as ProviderId);
                setModel('');
              }}
              style={inputStyle}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>

            <p className="muted" style={{ margin: '4px 0' }}>
              Model (optional)
            </p>
            <input
              aria-label="Model"
              placeholder={preset.defaultModel}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={inputStyle}
            />

            <p className="muted" style={{ margin: '4px 0' }}>
              API key
            </p>
            <input
              aria-label="API key"
              type="password"
              autoComplete="off"
              placeholder="paste your key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={inputStyle}
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              {preset.keyHint}
            </p>

            <button
              type="button"
              className="btn full"
              disabled={!apiKey.trim() || status === 'saving'}
              onClick={handleSave}
            >
              {status === 'saving' ? 'Saving…' : 'Save'}
            </button>
            {status === 'saved' && (
              <p className="muted">Saved. Your key is encrypted server-side.</p>
            )}
            {error && <p className="warn">{error}</p>}
            <p className="muted" style={{ fontSize: 12 }}>
              Your key is sent over HTTPS, encrypted at rest, and never shown again or logged.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
