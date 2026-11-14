import { useCallback, useEffect, useRef, useState } from 'react';
import type { Me } from '../lib/account.js';
import { readConfig } from '../lib/config.js';
import { GoogleIcon } from './icons/GoogleIcon.js';
import { Button } from './ui/button.js';

interface Providers {
  google: boolean;
}

/**
 * Optional account section. The app works without signing in — an anonymous
 * account is created on first use — so this never blocks anything; it only
 * offers to attach a Google identity so the account survives a cleared browser
 * and works on a second device.
 */
export function AccountCard({ onSignedIn }: { onSignedIn?: (me: Me) => void } = {}) {
  const { apiBase, hasBackend } = readConfig();
  // null = not known yet. Never treated as "signed out": a signed-in person must
  // not be shown the sign-in buttons while we are still asking, or if we fail to.
  const [me, setMe] = useState<Me | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [providers, setProviders] = useState<Providers>({ google: false });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // `onSignedIn` fires on a signed-out -> signed-in change seen after mount, not
  // for someone who was already signed in when the card opened.
  const wasSignedIn = useRef<boolean | null>(null);
  const signedInCb = useRef(onSignedIn);
  signedInCb.current = onSignedIn;

  const load = useCallback(async () => {
    if (!hasBackend) return;
    try {
      const [meRes, provRes] = await Promise.all([
        fetch(`${apiBase}/api/auth/me`, { credentials: 'include' }),
        fetch(`${apiBase}/api/auth/providers`, { credentials: 'include' }),
      ]);
      if (meRes.ok) {
        const next = (await meRes.json()) as Me;
        setMe(next);
        setLoadFailed(false);
        if (next.signedIn && wasSignedIn.current === false) signedInCb.current?.(next);
        wasSignedIn.current = next.signedIn;
      }
      if (provRes.ok) setProviders((await provRes.json()) as Providers);
      if (!meRes.ok) setLoadFailed(true);
    } catch {
      setLoadFailed(true);
    }
  }, [apiBase, hasBackend]);

  useEffect(() => {
    void load();
  }, [load]);

  // A Google round trip that left this page open finishes while we are in the
  // background: look again on return.
  useEffect(() => {
    if (!onSignedIn) return;
    const again = () => {
      if (document.visibilityState !== 'hidden') void load();
    };
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('focus', again);
    };
  }, [load, onSignedIn]);

  async function signOut() {
    if (!hasBackend) return;
    setBusy(true);
    try {
      await fetch(`${apiBase}/api/auth/logout`, { method: 'POST', credentials: 'include' });
      wasSignedIn.current = false;
      setMe({ signedIn: false, via: null, method: null, email: null, userId: null });
      setNotice('Signed out. This browser keeps working as an anonymous account.');
    } finally {
      setBusy(false);
    }
  }

  if (!hasBackend) return null;

  return (
    <div className="flex flex-col gap-3">
      {me === null ? (
        loadFailed ? (
          <>
            <p className="text-muted-foreground text-caption">
              Could not check your account right now.
            </p>
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground text-caption" aria-busy="true">
            Checking your account…
          </p>
        )
      ) : me.signedIn ? (
        <>
          <div className="flex flex-col gap-0.5">
            <p className="text-body font-medium break-all">{me.email ?? 'Your account'}</p>
            <p className="text-muted-foreground text-caption">
              {me.method === 'google' ? 'Signed in with Google' : 'Signed in'}
            </p>
          </div>
          <Button variant="secondary" disabled={busy} onClick={() => void signOut()}>
            Sign out
          </Button>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-caption">
            Optional. Signing in keeps your meals when you change phone or clear your browser.
          </p>

          {providers.google && (
            <Button asChild variant="secondary">
              <a href={`${apiBase}/api/auth/start/google`}>
                <GoogleIcon />
                Continue with Google
              </a>
            </Button>
          )}
        </>
      )}

      {notice && <p className="text-caption text-success">{notice}</p>}
    </div>
  );
}
