(function () {
  // Installable app (docs/INSTALLABLE_APP.md): registers the service worker and keeps the browser's install prompt so
  // Settings can offer "Install the app". window.svuApp is used by the notification settings for push.
  let deferred = null;
  const listeners = new Set();
  const changed = () => listeners.forEach((listener) => listener());
  const registration = 'serviceWorker' in navigator ? navigator.serviceWorker.register('/sw.js').catch(() => null) : Promise.resolve(null);
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferred = event; changed(); });
  window.addEventListener('appinstalled', () => { deferred = null; changed(); });
  const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  window.svuApp = {
    registration: () => registration,
    installed: standalone,
    canPrompt: () => Boolean(deferred),
    ios,
    async install() { if (!deferred) return false; deferred.prompt(); const choice = await deferred.userChoice.catch(() => null); deferred = null; changed(); return choice?.outcome === 'accepted'; },
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); }
  };
})();
