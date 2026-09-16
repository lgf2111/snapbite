import { useEffect, useState } from 'react';
import type { SettingsView } from '../lib/api.js';
import type { Backend } from '../lib/backend.js';

interface SettingsScreenProps {
  backend: Backend;
}

/**
 * Settings: connect a BYOK AI key. The key is sent over HTTPS and encrypted
 * server-side; it's never shown back — only a "Connected" status and last 4.
 */
export function SettingsScreen({ backend }: SettingsScreenProps) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend
      .getSettings()
      .then(setSettings)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load settings'));
  }, [backend]);

  async function handleSave() {
    const key = apiKey.trim();
    if (!key) return;
    setStatus('saving');
    setError(null);
    try {
      const updated = await backend.saveApiKey(key);
      setSettings(updated);
      setApiKey('');
      setStatus('saved');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Could not save key');
    }
  }

  const isLocal = backend.mode === 'local';

  return (
    <div>
      <h1>Settings</h1>

      {isLocal ? (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            Running in demo mode with a mock analyzer — no API key needed. Connect a Worker backend
            to use a real AI key.
          </p>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="header" style={{ marginBottom: 8 }}>
              <span className="food-name">AI provider</span>
              <span className="muted">{settings?.aiProvider ?? '…'}</span>
            </div>
            {settings?.connected ? (
              <p style={{ margin: 0 }}>
                ✓ Connected
                {settings.keyLast4 ? (
                  <span className="muted"> · key ending …{settings.keyLast4}</span>
                ) : null}
              </p>
            ) : (
              <p className="warn" style={{ margin: 0 }}>
                No API key yet — add one below to analyze photos.
              </p>
            )}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <p className="muted" style={{ marginTop: 0 }}>
              {settings?.connected ? 'Replace your API key' : 'Add your DeepSeek API key'}
            </p>
            <input
              aria-label="API key"
              type="password"
              autoComplete="off"
              placeholder="sk-…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{
                width: '100%',
                padding: 12,
                borderRadius: 8,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                marginBottom: 8,
              }}
            />
            <button
              type="button"
              className="btn full"
              disabled={!apiKey.trim() || status === 'saving'}
              onClick={handleSave}
            >
              {status === 'saving' ? 'Saving…' : 'Save key'}
            </button>
            {status === 'saved' && <p className="muted">Saved. Your key is encrypted server-side.</p>}
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
