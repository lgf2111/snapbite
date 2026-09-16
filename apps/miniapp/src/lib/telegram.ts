/**
 * Thin, defensive Telegram Mini App integration. The app must also run in a
 * plain browser during development (no Telegram host), so every call is guarded
 * and failures are swallowed — we never block rendering on the SDK.
 *
 * Only the pieces Task 5 needs are wired up; deeper SDK use (initData for the
 * Worker) arrives with the backend in later tasks.
 */
import { init, retrieveRawInitData, viewport } from '@telegram-apps/sdk-react';

let initialized = false;

/**
 * Returns the raw, signed initData string to send to the Worker for auth.
 * Empty when not running inside Telegram (browser dev / no backend).
 */
export function getRawInitData(): string {
  try {
    return retrieveRawInitData() ?? '';
  } catch {
    return '';
  }
}

/** True when running inside the Telegram client (best-effort detection). */
export function isTelegramEnv(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as { Telegram?: unknown }).Telegram !== 'undefined'
  );
}

/** Initializes the SDK once; safe to call in any environment. */
export function initTelegram(): void {
  if (initialized || !isTelegramEnv()) return;
  try {
    init();
    if (viewport.mount.isAvailable()) {
      void viewport.mount();
      viewport.expand();
    }
    initialized = true;
  } catch {
    // Not in a Telegram host, or SDK unavailable — carry on in browser mode.
  }
}
