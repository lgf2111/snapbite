import { takeSharedPhoto } from './shareTarget.js';

/**
 * How the app was launched, from the URL.
 *
 *   /?capture=camera | library | manual   a long-press shortcut on the installed icon
 *   /?shared=1                            a photo was shared to SnapBite (see shareTarget.ts)
 *
 * Read once, then removed from the address bar so a reload does not repeat it.
 *
 * Note for `camera` and `library`: these cannot open the camera or the gallery by
 * themselves. A web page may not call `input.click()` (or otherwise open a file picker)
 * without a user gesture, and a launch from a shortcut is not one; there is no web API
 * that opens the camera programmatically. So they open the capture menu with that option
 * highlighted, and the next tap is the shutter.
 */
export type LaunchIntent =
  | { type: 'menu'; highlight: 'photo' | 'upload' }
  | { type: 'manual' }
  | { type: 'shared'; photo: Promise<File | null> };

let taken: { value: LaunchIntent | null } | null = null;

export function takeLaunchIntent(): LaunchIntent | null {
  // Memoised: React StrictMode runs effects twice in development, and the second read
  // must not find the URL (or the shared photo) already consumed.
  if (taken) return taken.value;
  const url = new URL(window.location.href);
  const capture = url.searchParams.get('capture');
  const shared = url.searchParams.get('shared');

  let value: LaunchIntent | null = null;
  if (shared) value = { type: 'shared', photo: takeSharedPhoto() };
  else if (capture === 'camera') value = { type: 'menu', highlight: 'photo' };
  else if (capture === 'library') value = { type: 'menu', highlight: 'upload' };
  else if (capture === 'manual') value = { type: 'manual' };

  if (capture !== null || shared !== null) {
    url.searchParams.delete('capture');
    url.searchParams.delete('shared');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
  taken = { value };
  return value;
}

/** Test seam. */
export function resetLaunchIntent(): void {
  taken = null;
}
