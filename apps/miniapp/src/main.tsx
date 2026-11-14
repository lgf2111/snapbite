/**
 * Two ways in, one app:
 *  - Inside Telegram: the Mini App, authenticated by initData.
 *  - In any browser (incl. the installed PWA): the same app. Until sessions
 *    land it runs in demo mode against local storage, so the shell, capture and
 *    compression work but nothing is written to your account.
 *
 * The Telegram SDK is only pulled in when a Telegram host is present, and all
 * application code is a dynamic import so this entry stays tiny.
 */

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

/**
 * The service worker is only there to receive web push, so it is registered in
 * production builds and only where the browser has one. A failure to register
 * must never get in the way of the app.
 */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

void (async () => {
  registerServiceWorker();
  // Chrome can fire `beforeinstallprompt` before the app has mounted; start
  // listening now so the install card still gets it.
  void import('./lib/install.js').then((m) => m.watchInstallEvents());
  // Telegram Mini App and plain browser both mount the same React app. In a
  // browser it runs in demo mode until sessions land (see lib/backend.ts), but
  // the shell, capture and compression are real.
  await mountMiniApp();
})();
