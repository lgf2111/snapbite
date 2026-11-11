import { useCallback, useEffect, useState } from 'react';
import { readConfig } from '../lib/config.js';

interface Providers {
  email: boolean;
  google: boolean;
}

interface Me {
  signedIn: boolean;
  via: string | null;
  email: string | null;
  userId: string | null;
}

/**
 * Optional account section. The app works without signing in — an anonymous
 * account is created on first use — so this never blocks anything; it only
 * offers to attach an email/Google identity so the account survives a cleared
 * browser and works on a second device.
 */
export function AccountCard() {
  const workerUrl = readConfig().workerUrl;
  const [me, setMe] = useState<Me | null>(null);
  const [providers, setProviders] = useState<Providers>({ email: false, google: false });
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workerUrl) return;
    try {
      const [meRes, provRes] = await Promise.all([
        fetch(`${workerUrl}/api/auth/me`, { credentials: 'include' }),
        fetch(`${workerUrl}/api/auth/providers`, { credentials: 'include' }),
      ]);
      if (meRes.ok) setMe((await meRes.json()) as Me);
      if (provRes.ok) setProviders((await provRes.json()) as Providers);
    } catch {
      // Offline or misconfigured: the section simply doesn't render state.
    }
  }, [workerUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  // Surface the result of a round trip (?auth=ok / ?auth=expired / ...).
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('auth');
    if (!status) return;
    if (status === 'ok') setNotice('Signed in — this account now works on any device.');
    else if (status === 'expired') setError('That sign-in link expired or was already used. Request a new one.');
    else if (status === 'state') setError('The sign-in was interrupted. Please try again.');
    else if (status === 'unverified') setError('That email is not verified with the provider.');
    else if (status === 'conflict') setError('That address already belongs to another account.');
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  async function requestLink() {
    if (!workerUrl) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${workerUrl}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json()) as { delivered?: boolean; link?: string; detail?: string };
      if (!res.ok) {
        setError(body.detail ?? 'Could not send a link.');
      } else if (body.delivered) {
        setNotice(`Check ${email} for the sign-in link. It expires in 15 minutes.`);
      } else if (body.link) {
        // Email is not configured yet: hand the link over instead of hiding it.
        setNotice('Email is not configured, so here is the link: ');
        window.location.href = body.link;
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!workerUrl) return;
    setBusy(true);
    try {
      await fetch(`${workerUrl}/api/auth/logout`, { method: 'POST', credentials: 'include' });
      setMe({ signedIn: false, via: null, email: null, userId: null });
      setNotice('Signed out. This browser keeps working as an anonymous account.');
    } finally {
      setBusy(false);
    }
  }

  if (!workerUrl) return null;

  return (
    <div className="rounded-xl border border-[var(--tg-theme-secondary-bg-color,#223140)] p-4">
      <h3 className="text-sm font-semibold">Account</h3>

      {me?.signedIn ? (
        <>
          <p className="mt-1 text-xs text-[var(--tg-theme-hint-color,#9fb2c4)]">
            Signed in as {me.email ?? 'your account'}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void signOut()}
            className="mt-3 w-full rounded-lg border border-[var(--tg-theme-secondary-bg-color,#223140)] px-3 py-2 text-xs font-medium disabled:opacity-60"
          >
            Sign out
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-[var(--tg-theme-hint-color,#9fb2c4)]">
            Optional. You can log meals without an account — signing in only keeps them when you
            change phone or clear your browser.
          </p>

          {providers.google && (
            <a
              href={`${workerUrl}/api/auth/start/google`}
              className="mt-3 block w-full rounded-lg bg-[var(--tg-theme-button-color,#3aa0ff)] px-3 py-2.5 text-center text-xs font-semibold text-[var(--tg-theme-button-text-color,#06121f)]"
            >
              Continue with Google
            </a>
          )}

          {providers.email && (
            <div className="mt-3 flex flex-col gap-2">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border border-[var(--tg-theme-secondary-bg-color,#223140)] bg-transparent px-3 py-2 text-xs"
              />
              <button
                type="button"
                disabled={busy || !email.includes('@')}
                onClick={() => void requestLink()}
                className="rounded-lg border border-[var(--tg-theme-secondary-bg-color,#223140)] px-3 py-2 text-xs font-medium disabled:opacity-50"
              >
                Email me a sign-in link
              </button>
            </div>
          )}

          {!providers.google && !providers.email && (
            <p className="mt-2 text-xs text-[var(--tg-theme-hint-color,#9fb2c4)]">
              No sign-in method is configured on the server yet.
            </p>
          )}
        </>
      )}

      {notice && <p className="mt-2 text-xs text-emerald-400">{notice}</p>}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
