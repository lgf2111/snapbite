/**
 * Opening links that leave the app.
 *
 * Three hosts, three behaviours, and only one of them can hand off to the
 * system browser:
 *
 *  - Inside Telegram, `WebApp.openLink(url, { try_instant_view: false })` opens
 *    the phone's real browser. This is the only path that truly leaves.
 *  - An installed iOS PWA (Home Screen) opens `target="_blank"` links in Safari's
 *    in-app browser — Apple does not let a web app hand off to Safari. The link
 *    still leaves our UI and shows a URL bar, which is the most iOS allows.
 *  - A normal browser tab or Android: a new tab / the default browser.
 *
 * So this helper does what the host permits and nothing more. Do not "fix" it by
 * navigating the app's own window: that replaces the app and loses state.
 */

/** True when running as an installed app (Home Screen on iOS, standalone on Android). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

function telegramOpenLink(url: string): boolean {
  const tg = (window as { Telegram?: { WebApp?: { openLink?: (u: string, o?: object) => void } } })
    .Telegram;
  const openLink = tg?.WebApp?.openLink;
  if (typeof openLink !== 'function') return false;
  try {
    // `try_instant_view: false` keeps Telegram from rendering the page itself.
    openLink(url, { try_instant_view: false });
    return true;
  } catch {
    return false;
  }
}

/** Opens an external URL the best way the current host allows. */
export function openExternal(url: string): void {
  if (telegramOpenLink(url)) return;
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    // Popup blocked (rare, but Safari sometimes blocks programmatic opens).
    window.location.assign(url);
  }
}
