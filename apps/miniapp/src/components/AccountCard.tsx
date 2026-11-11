import { useCallback, useEffect, useState } from 'react';
import { readConfig } from '../lib/config.js';
import { Button } from './ui/button.js';
import { Card, CardContent } from './ui/card.js';
import { Input } from './ui/input.js';

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
    <Card>
      <CardContent className="flex flex-col gap-3">
        <span className="font-medium">Account</span>

        {me?.signedIn ? (
          <>
            <p className="text-muted-foreground text-caption">
              Signed in as {me.email ?? 'your account'}
            </p>
            <Button variant="secondary" disabled={busy} onClick={() => void signOut()}>
              Sign out
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-caption">
              Optional — signing in keeps your meals when you change phone or clear your browser.
            </p>

            {providers.google && (
              <Button asChild>
                <a href={`${workerUrl}/api/auth/start/google`}>Continue with Google</a>
              </Button>
            )}

            {providers.email && (
              <>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  aria-label="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Button
                  variant="secondary"
                  disabled={busy || !email.trim()}
                  onClick={() => void requestLink()}
                >
                  {busy ? 'Sending…' : 'Email me a sign-in link'}
                </Button>
              </>
            )}

            {notice && <p className="text-caption text-[var(--success)]">{notice}</p>}
            {error && <p className="text-caption text-destructive">{error}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
