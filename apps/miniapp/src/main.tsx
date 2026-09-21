/**
 * The same URL serves two audiences:
 *  - In a normal browser it's a public landing page (static HTML in index.html),
 *    so visitors get an instant, JS-light page explaining the product.
 *  - Inside Telegram it's the Mini App.
 *
 * The React app, its styles, and the Telegram SDK are only pulled in when we're
 * actually inside Telegram, via dynamic import — a browser visitor downloads
 * just this small entry and none of the app bundle.
 *
 * Detection: a cheap inline check of the `tgWebApp*` launch params Telegram puts
 * in the URL/sessionStorage as a fast path, then the SDK's own `isTMA()` as the
 * authoritative check. We do NOT rely on `window.Telegram` — that global isn't
 * guaranteed unless the legacy telegram-web-app.js is loaded, and depending on
 * it made the Mini App fall through to the landing page inside Telegram.
 */

/** Cheap, dependency-free launch-param sniff (mirrors what the SDK checks). */
function hasLaunchParams(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const hay = `${window.location.hash}${window.location.search}`;
    if (hay.includes('tgWebApp')) return true;
    const stored =
      sessionStorage.getItem('@telegram-apps/launch-params') ??
      sessionStorage.getItem('tapps/launchParams');
    if (stored && stored.includes('tgWebApp')) return true;
    const tg = (window as { Telegram?: { WebApp?: unknown } }).Telegram;
    if (tg?.WebApp) return true;
  } catch {
    /* sessionStorage can throw in locked-down contexts */
  }
  return false;
}

async function isTelegramMiniApp(): Promise<boolean> {
  if (hasLaunchParams()) return true;
  // Authoritative check straight from the SDK (reads launch params, incl. the
  // SDK's own persisted copy). Dynamic import so it stays out of a browser load.
  try {
    const { isTMA } = await import('@telegram-apps/sdk-react');
    return isTMA();
  } catch {
    return false;
  }
}

async function mountMiniApp(): Promise<void> {
  const [{ StrictMode }, { createRoot }, { App }, telegram] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('./App.js'),
    import('./lib/telegram.js'),
  ]);
  await import('./index.css');

  telegram.initTelegram();
  telegram.applyTelegramTheme();

  // Hand the page over to the app: drop the landing markup, mount into #root.
  document.getElementById('landing')?.remove();
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Root element #root not found');

  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void (async () => {
  if (await isTelegramMiniApp()) {
    await mountMiniApp();
  }
  // Otherwise: leave the static landing in index.html visible, run no app code.
})();
