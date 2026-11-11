import { useCallback, useEffect, useState } from 'react';

/**
 * Whether SnapBite is running as an installed web app, and what the browser
 * lets us do about it.
 *
 * Platform reality, so the UI does not over-promise:
 *  - iOS Safari has no install API. `beforeinstallprompt` never fires there;
 *    all we can do is detect standalone and show instructions.
 *  - Android Chrome fires `beforeinstallprompt` (once per page load, and it is
 *    single-use), so we capture it and can call `prompt()`.
 *  - "Installed" is only observable while running as the installed app. We can
 *    never know that someone installed and later deleted it.
 */

export type InstallPlatform = 'ios' | 'android' | 'other';

/** Chrome's install prompt event; not in lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type NavLike = Pick<Navigator, 'userAgent' | 'maxTouchPoints'>;

/**
 * iPhone/iPod by UA. iPadOS reports a Mac UA, so an iPad is a Macintosh with a
 * touch screen (a real Mac has maxTouchPoints 0). Everything else that is not
 * Android is desktop and gets nothing.
 */
export function installPlatform(nav: NavLike = navigator): InstallPlatform {
  const ua = nav.userAgent;
  if (/iPhone|iPod|iPad/.test(ua)) return 'ios';
  if (/Macintosh/.test(ua) && nav.maxTouchPoints > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

/**
 * Add to Home Screen steps name Safari's own Share button. Other iOS browsers
 * and in-app webviews put it elsewhere (or nowhere), so say so.
 */
export function isIosSafari(nav: NavLike = navigator): boolean {
  const ua = nav.userAgent;
  return /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|Line\//.test(ua);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const viaMedia = window.matchMedia?.('(display-mode: standalone)').matches === true;
  const viaIos = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return viaMedia || viaIos;
}

/* ---- Android install prompt: captured at module level, because Chrome can
   fire it before React has mounted. ---- */

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let watching = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/** Start listening for the install events. Idempotent; call it as early as possible. */
export function watchInstallEvents(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Hold it back so our own card decides when to ask.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

/** Test seam: forget captured events. */
export function resetInstallState(): void {
  deferred = null;
  installed = false;
  emit();
}

export interface InstallState {
  platform: InstallPlatform;
  /** Running as an installed app right now, or just installed this session. */
  standalone: boolean;
  /** Chrome handed us a prompt we can still use (Android). */
  canPrompt: boolean;
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

export function useInstallState(): InstallState {
  const [, bump] = useState(0);
  const [standalone, setStandalone] = useState(isStandalone);

  useEffect(() => {
    watchInstallEvents();
    const rerender = () => {
      setStandalone(isStandalone());
      bump((n) => n + 1);
    };
    listeners.add(rerender);
    const mq = window.matchMedia?.('(display-mode: standalone)');
    mq?.addEventListener?.('change', rerender);
    return () => {
      listeners.delete(rerender);
      mq?.removeEventListener?.('change', rerender);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const event = deferred;
    if (!event) return 'unavailable' as const;
    // The event is single-use: once prompted, fall back to menu instructions.
    deferred = null;
    emit();
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
  }, []);

  return {
    platform: installPlatform(),
    standalone: standalone || installed,
    canPrompt: deferred !== null,
    promptInstall,
  };
}
