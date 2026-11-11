/**
 * URL routes for the app.
 *
 * The app used to keep navigation entirely in React state, which meant a reload
 * always dumped you on Home and lost the open meal. Now every screen has a
 * path, so refresh, back/forward, and deep links from the bot all behave:
 *
 *   /                 today
 *   /day/2026-11-11   a specific day
 *   /meal/:id         one meal's detail
 *   /settings         settings
 *   /verify           magic-link landing (handled in main.tsx)
 *
 * Deliberately hand-rolled: the surface is five routes, and pulling in a router
 * for that would be more code to keep current than the parser itself. If the
 * app grows nested screens or code-split layouts, replace this file wholesale.
 */

export interface RouteHome {
  name: 'home';
}
export interface RouteDay {
  name: 'day';
  date: string;
}
export interface RouteMeal {
  name: 'meal';
  id: string;
}
export interface RouteSettings {
  name: 'settings';
}

export type Route = RouteHome | RouteDay | RouteMeal | RouteSettings;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseRoute(pathname: string): Route {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };

  const [head, arg] = parts;
  if (head === 'settings' && parts.length === 1) return { name: 'settings' };
  if (head === 'day' && arg && DATE_RE.test(arg) && parts.length === 2) {
    return { name: 'day', date: arg };
  }
  if (head === 'meal' && arg && parts.length === 2) return { name: 'meal', id: arg };

  // Unknown path: show today rather than a 404 the user cannot act on.
  return { name: 'home' };
}

export function routeToPath(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/';
    case 'day':
      return `/day/${route.date}`;
    case 'meal':
      return `/meal/${encodeURIComponent(route.id)}`;
    case 'settings':
      return '/settings';
  }
}

/**
 * Pushes a route without a full page load. Falls back to `replaceState` when the
 * target equals the current URL, so tapping the same tab twice does not stack
 * identical history entries the user then has to back through.
 */
export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  const path = routeToPath(route);
  const current = `${window.location.pathname}${window.location.search}`;
  if (path === window.location.pathname && !window.location.search) return;
  if (opts.replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  void current;
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Subscribes to back/forward (and to `navigate`). Returns the unsubscribe fn so
 * a component can clean up in an effect.
 */
export function onRouteChange(handler: (route: Route) => void): () => void {
  const listener = () => handler(parseRoute(window.location.pathname));
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}
