/**
 * Leaves the app for `url` in the same tab.
 *
 * A function of its own so it can be called from inside a click handler (which keeps
 * it from being treated as a popup) and replaced in tests: `window.location.assign`
 * itself cannot be stubbed in jsdom.
 */
export function navigateTo(url: string): void {
  window.location.assign(url);
}
