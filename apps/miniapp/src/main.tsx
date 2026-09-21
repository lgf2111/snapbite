/**
 * The same URL serves two audiences:
 *  - In a normal browser it's a public landing page (static HTML in index.html),
 *    so visitors get an instant, JS-light page explaining the product.
 *  - Inside Telegram it's the Mini App.
 *
 * We only pull in the React app, its styles, and the Telegram SDK when actually
 * running inside Telegram — a dynamic import so browser visitors download just
 * this tiny entry and none of the app bundle. The Telegram check is inlined
 * (not imported) so nothing from the app graph lands in this entry chunk.
 */
function inTelegram(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as { Telegram?: unknown }).Telegram !== 'undefined'
  );
}

if (inTelegram()) {
  void (async () => {
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
  })();
}
// In a plain browser we intentionally do nothing: the static landing in
// index.html stays visible and no app code runs.
