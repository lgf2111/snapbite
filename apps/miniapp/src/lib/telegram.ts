/**
 * Thin, defensive Telegram Mini App integration. The app must also run in a
 * plain browser during development (no Telegram host), so every call is guarded
 * and failures are swallowed — we never block rendering on the SDK.
 *
 * The SDK's component API is signal + mount based. Every scope object
 * (backButton, mainButton, themeParams, hapticFeedback) exposes methods wrapped
 * with an `.isAvailable()` predicate; we always check that before calling so
 * the same code is a safe no-op in a browser and in jsdom.
 */
import {
  backButton,
  hapticFeedback,
  init,
  mainButton,
  retrieveRawInitData,
  themeParams,
  viewport,
} from '@telegram-apps/sdk-react';

let initialized = false;

/** Narrow helper: is this wrapped SDK function actually usable right now? */
function available(fn: unknown): boolean {
  try {
    const maybe = fn as { isAvailable?: () => boolean } | undefined;
    return typeof maybe?.isAvailable === 'function' && maybe.isAvailable();
  } catch {
    return false;
  }
}

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

/**
 * Binds Telegram theme colors to the CSS custom properties the app already
 * uses, so the UI follows the user's Telegram light/dark theme. When not in
 * Telegram (browser/jsdom) this no-ops and the hardcoded dark palette in
 * styles.css remains the fallback.
 */
export function applyTelegramTheme(): void {
  if (!isTelegramEnv()) return;
  try {
    if (themeParams.mountSync.isAvailable()) {
      themeParams.mountSync();
    }
    // Read via the SDK's typed per-color computed signals (camelCase getters),
    // each returning an "#rrggbb" string or undefined when Telegram omits it.
    const root = document.documentElement;
    const set = (name: string, value: string | undefined) => {
      if (value) root.style.setProperty(name, value);
    };
    // Map Telegram theme colors onto the shadcn/Tailwind design tokens so the
    // whole UI follows the user's Telegram theme. Hex values are valid CSS for
    // these custom properties.
    const bg = themeParams.backgroundColor();
    const secondary = themeParams.secondaryBackgroundColor();
    const section = themeParams.sectionBackgroundColor();
    const text = themeParams.textColor();
    const hint = themeParams.hintColor() ?? themeParams.subtitleTextColor();
    const button = themeParams.buttonColor() ?? themeParams.linkColor();
    const buttonText = themeParams.buttonTextColor();
    const border = themeParams.sectionSeparatorColor();
    const destructive = themeParams.destructiveTextColor();
    const cardBg = secondary ?? section;

    set('--background', bg);
    set('--foreground', text);
    set('--card', cardBg);
    set('--card-foreground', text);
    set('--popover', cardBg);
    set('--popover-foreground', text);
    set('--primary', button);
    set('--primary-foreground', buttonText);
    set('--secondary', section ?? secondary);
    set('--secondary-foreground', text);
    set('--muted', section ?? secondary);
    set('--muted-foreground', hint);
    set('--accent', section ?? secondary);
    set('--accent-foreground', text);
    set('--border', border);
    set('--input', border);
    set('--ring', button);
    set('--destructive', destructive);

    const dark = themeParams.isDark();
    if (typeof dark === 'boolean') {
      root.style.setProperty('color-scheme', dark ? 'dark' : 'light');
      root.classList.toggle('dark', dark);
    }
  } catch {
    // Theme unavailable — keep the fallback palette.
  }
}

// ---------------------------------------------------------------------------
// Native back button
// ---------------------------------------------------------------------------

let backButtonMounted = false;

function ensureBackButtonMounted(): boolean {
  if (!isTelegramEnv()) return false;
  try {
    if (!backButtonMounted && available(backButton.mount)) {
      backButton.mount();
      backButtonMounted = true;
    }
    return backButtonMounted;
  } catch {
    return false;
  }
}

/**
 * Shows the native Telegram BackButton and wires `onClick`. Returns a cleanup
 * function that removes the handler and hides the button. No-ops (returning a
 * no-op cleanup) when not in Telegram.
 */
export function showBackButton(onClick: () => void): () => void {
  if (!ensureBackButtonMounted()) return () => {};
  let off: (() => void) | undefined;
  try {
    if (available(backButton.onClick)) {
      off = backButton.onClick(onClick);
    }
    if (available(backButton.show)) backButton.show();
  } catch {
    // ignore
  }
  return () => {
    try {
      off?.();
      if (available(backButton.hide)) backButton.hide();
    } catch {
      // ignore
    }
  };
}

/** Hides the native BackButton if it is mounted. Safe anywhere. */
export function hideBackButton(): void {
  try {
    if (available(backButton.hide)) backButton.hide();
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Native main button
// ---------------------------------------------------------------------------

let mainButtonMounted = false;

function ensureMainButtonMounted(): boolean {
  if (!isTelegramEnv()) return false;
  try {
    if (!mainButtonMounted && available(mainButton.mount)) {
      mainButton.mount();
      mainButtonMounted = true;
    }
    return mainButtonMounted;
  } catch {
    return false;
  }
}

export interface MainButtonConfig {
  text: string;
  onClick: () => void;
  enabled?: boolean;
  loading?: boolean;
}

/**
 * Configures and shows the native MainButton for a primary action, wiring its
 * click handler. Returns a cleanup that hides the button and removes the
 * handler. Returns `null` when the native button is unavailable, so callers can
 * fall back to their in-page button.
 */
export function showMainButton(config: MainButtonConfig): (() => void) | null {
  if (!ensureMainButtonMounted()) return null;
  let off: (() => void) | undefined;
  try {
    if (available(mainButton.setParams)) {
      mainButton.setParams({
        text: config.text,
        isVisible: true,
        isEnabled: config.enabled ?? true,
        isLoaderVisible: config.loading ?? false,
      });
    }
    if (available(mainButton.onClick)) {
      off = mainButton.onClick(config.onClick);
    }
  } catch {
    return null;
  }
  return () => {
    try {
      off?.();
      if (available(mainButton.setParams)) {
        mainButton.setParams({ isVisible: false });
      }
    } catch {
      // ignore
    }
  };
}

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------

/** Success/error/warning notification haptic; no-ops outside Telegram. */
export function hapticNotify(type: 'success' | 'error' | 'warning'): void {
  try {
    if (available(hapticFeedback.notificationOccurred)) {
      hapticFeedback.notificationOccurred(type);
    }
  } catch {
    // ignore
  }
}

/** Impact haptic (used for taps like delete confirm); no-ops outside Telegram. */
export function hapticImpact(style: 'light' | 'medium' | 'heavy' = 'medium'): void {
  try {
    if (available(hapticFeedback.impactOccurred)) {
      hapticFeedback.impactOccurred(style);
    }
  } catch {
    // ignore
  }
}
