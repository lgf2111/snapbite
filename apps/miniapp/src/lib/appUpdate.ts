import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * Are we running the build the server has, or an old one?
 *
 * The bundle embeds its build id at build time (`__BUILD_ID__`, see
 * vite.config.ts). Every deploy also writes `/version.json` with the id of the
 * build it just uploaded. Comparing the two is enough to know that a tab has
 * outlived a deploy — no websocket, no polling, no service-worker handshake.
 *
 * This is a notice, never an update. The person may be halfway through an AI
 * instruction or holding an unsaved photo draft, so the app only offers a
 * reload; it never takes one.
 */

/** The build compiled into this bundle; `vite.config.ts` replaces the define. */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

export const VERSION_URL = '/version.json';
export const UPDATE_MESSAGE = 'App updated. Tap to reload';
export const UPDATE_TOAST_ID = 'app-update';
export const DISMISSED_BUILD_KEY = 'snapbite.update.dismissed';

/** The shortest gap between two checks, whatever asked for one. */
export const CHECK_INTERVAL_MS = 60_000;

export interface BuildVersion {
  id: string;
  builtAt?: number;
}

/**
 * The deployed build, or null when there is nothing trustworthy to compare.
 * A missing file, a 404, a captive portal, a half-written body: all silence.
 * A version check is never worth an error message, let alone a console trail.
 */
export async function fetchBuildVersion(): Promise<BuildVersion | null> {
  try {
    const res = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<BuildVersion> | null;
    if (!data || typeof data.id !== 'string' || data.id.length === 0) return null;
    return typeof data.builtAt === 'number'
      ? { id: data.id, builtAt: data.builtAt }
      : { id: data.id };
  } catch {
    return null;
  }
}

/** The id the person already dismissed in this tab, if any. */
export function dismissedBuild(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISSED_BUILD_KEY);
  } catch {
    return null;
  }
}

/** Stays quiet for this id for the rest of the tab's session — and only this id. */
export function rememberDismissedBuild(id: string): void {
  try {
    window.sessionStorage.setItem(DISMISSED_BUILD_KEY, id);
  } catch {
    // Private mode: the notice may return on the next check, which is harmless.
  }
}

/**
 * A surface that owns the screen: setup, the add-a-meal menu, or any dialog.
 * The update notice waits for the same clear screen a toast does: a notice over
 * an open sheet competes with the control the person is using.
 *
 * Radix leaves a closing dialog mounted through its exit animation, so only
 * `data-state` other than `closed` counts.
 */
export function hasBlockingSurface(root: ParentNode = document): boolean {
  if (root.querySelector('[data-testid="capture-menu"]')) return true;
  for (const surface of root.querySelectorAll('[role="dialog"][aria-modal="true"]')) {
    if (surface.getAttribute('data-state') !== 'closed') return true;
  }
  return false;
}

export interface AppUpdateOptions {
  /** Overrides the compiled-in id (tests, or a host that knows better). */
  buildId?: string;
  /** Extra app state that owns the screen: onboarding, the capture menu. */
  isBlocked?: () => boolean;
  /** Test seam; defaults to Date.now. */
  now?: () => number;
  /** Test seam; defaults to a real page reload. */
  reload?: () => void;
}

/**
 * Watches for a deploy while the app is open.
 *
 * `check` asks now: first paint (never in front of it), return to the app, and
 * window focus. Those are events, not a timer — there is no interval at all.
 * `checkAfterActivity` is for work that already round-tripped (a saved meal, a
 * screen change) and shares a one-minute floor, so a busy session cannot turn
 * those moments into polling. A hidden page never fetches either way: coming
 * back is the moment the answer matters.
 */
export function useAppUpdate(options: AppUpdateOptions = {}): {
  check: () => void;
  checkAfterActivity: () => void;
} {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const inFlight = useRef(false);
  const lastCheckAt = useRef(0);
  const notifiedId = useRef<string | null>(null);
  const pendingRef = useRef<BuildVersion | null>(null);
  const [pending, setPending] = useState<BuildVersion | null>(null);

  /** Show the held notice if the screen is clear; otherwise keep holding it. */
  const flush = useCallback(() => {
    const version = pendingRef.current;
    if (!version) return;
    if (document.visibilityState === 'hidden') return;
    if (optionsRef.current.isBlocked?.() || hasBlockingSurface()) return;
    if (dismissedBuild() === version.id) {
      pendingRef.current = null;
      setPending(null);
      return;
    }

    pendingRef.current = null;
    setPending(null);
    notifiedId.current = version.id;
    toast.info(UPDATE_MESSAGE, {
      id: UPDATE_TOAST_ID,
      // A notice that vanishes before it is read is not a notice.
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
      action: {
        label: 'Reload',
        onClick: () => (optionsRef.current.reload ?? (() => window.location.reload()))(),
      },
      onDismiss: () => rememberDismissedBuild(version.id),
    });
  }, []);

  const runCheck = useCallback(
    async (throttled: boolean) => {
      if (inFlight.current) return;
      if (document.visibilityState === 'hidden') return;
      const now = optionsRef.current.now ?? Date.now;
      const at = now();
      // First check of the session is never throttled, whatever the clock says.
      if (throttled && lastCheckAt.current !== 0 && at - lastCheckAt.current < CHECK_INTERVAL_MS) {
        return;
      }
      lastCheckAt.current = at;

      inFlight.current = true;
      try {
        const version = await fetchBuildVersion();
        if (!version) return;
        if (version.id === (optionsRef.current.buildId ?? BUILD_ID)) return;
        if (version.id === notifiedId.current) return;
        if (dismissedBuild() === version.id) return;
        pendingRef.current = version;
        setPending(version);
        flush();
      } finally {
        inFlight.current = false;
      }
    },
    [flush],
  );

  const check = useCallback(() => {
    void runCheck(false);
  }, [runCheck]);
  const checkAfterActivity = useCallback(() => {
    void runCheck(true);
  }, [runCheck]);

  // First run: after the first paint, so the version fetch can never be in the
  // way of anything the person can see. Return-to-app and focus are the other
  // two moments a deploy matters.
  useEffect(() => {
    const timer = window.setTimeout(check, 0);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      flush();
      check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [check, flush]);

  // A held notice waits for the surface in its way to clear, then comes back.
  useEffect(() => {
    if (!pending) return;
    flush();
    const observer = new MutationObserver(flush);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'inert', 'aria-hidden'],
    });
    return () => observer.disconnect();
  }, [pending, flush]);

  return { check, checkAfterActivity };
}
