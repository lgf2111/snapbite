/**
 * React hooks that bind the native Telegram BackButton / MainButton to a
 * component's lifecycle. Both degrade to no-ops in a plain browser and jsdom,
 * where the underlying telegram.ts helpers already guard everything.
 */
import { useEffect, useRef, useState } from 'react';
import {
  type MainButtonConfig,
  hideBackButton,
  showBackButton,
  showMainButton,
} from './telegram.js';

/**
 * Shows the native BackButton while `active` is true, calling `onBack` when it
 * is pressed. Hides it on cleanup / when inactive. The latest `onBack` is used
 * without re-subscribing on every render.
 */
export function useBackButton(active: boolean, onBack: () => void): void {
  const handler = useRef(onBack);
  handler.current = onBack;

  useEffect(() => {
    if (!active) {
      hideBackButton();
      return;
    }
    const cleanup = showBackButton(() => handler.current());
    return cleanup;
  }, [active]);
}

/**
 * Shows the native MainButton for a primary action while `active` is true.
 * Returns whether the native button is actually being used, so callers can hide
 * their in-page fallback button when the native one is present.
 */
export function useMainButton(active: boolean, config: MainButtonConfig): boolean {
  const [usingNative, setUsingNative] = useState(false);
  const cfg = useRef(config);
  cfg.current = config;

  // Deliberately depends on the specific config FIELDS (via the cfg ref), not
  // the whole `config` object, which changes identity every render and would
  // thrash the native button.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional field-level deps via ref
  useEffect(() => {
    if (!active) {
      setUsingNative(false);
      return;
    }
    const cleanup = showMainButton({
      text: cfg.current.text,
      onClick: () => cfg.current.onClick(),
      enabled: cfg.current.enabled,
      loading: cfg.current.loading,
    });
    setUsingNative(cleanup !== null);
    return cleanup ?? undefined;
    // Re-run only when the label/enabled/loading change.
  }, [active, config.text, config.enabled, config.loading]);

  return usingNative;
}
