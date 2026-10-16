(function () {
  // Settings → Notifications → This device (docs/INSTALLABLE_APP.md): install the app, and turn push notifications on or
  // off for this browser. Registers into the notification settings panel.
  const ui = window.svuUI, esc = ui.esc;
  const token = () => window.svuSession.get()?.token;
  let status = null;
  const loadStatus = () => status ||= fetch('/api/push/status').then((r) => r.json()).then((body) => body.data).catch(() => ({ enabled: false }));
  const toKey = (base64) => { const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)); };
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  async function current() { const reg = await window.svuApp?.registration(); return reg ? reg.pushManager.getSubscription() : null; }
  async function api(method, body) {
    const response = await fetch('/api/me/push-subscriptions', { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || 'This device could not be updated.');
    return payload.data;
  }

  async function render(host) {
    const box = document.createElement('div');
    box.className = 'notify-device';
    host.append(box);
    const info = await loadStatus();
    const subscription = supported() && info.enabled ? await current().catch(() => null) : null;
    const app = window.svuApp;
    const installRow = app?.installed() ? `<li class="ui-row notify-row"><div><strong>App installed</strong><span class="ui-meta">You are using the installed South Valley University app.</span></div>${ui.ico('check', 'green', 'ui-icon-sm')}</li>`
      : app?.canPrompt() ? `<li class="ui-row notify-row"><div><strong>Install the app</strong><span class="ui-meta">Open the portal from your home screen or desktop, like any other app.</span></div><button class="button button-secondary" type="button" data-app-install>Install</button></li>`
      : `<li class="ui-row notify-row"><div><strong>Install the app</strong><span class="ui-meta">${app?.ios() ? 'In Safari, tap Share, then "Add to Home Screen".' : 'Use your browser menu: "Install app" or "Add to home screen".'}</span></div>${ui.ico('grid', '', 'ui-icon-sm')}</li>`;
    const denied = supported() && Notification.permission === 'denied';
    const pushRow = !info.enabled ? '' : !supported() ? `<li class="ui-row notify-row"><div><strong>Notifications on this device</strong><span class="ui-meta">This browser cannot receive notifications${app?.ios() ? '. On iPhone, install the app first, then turn them on here.' : '.'}</span></div></li>`
      : `<li class="ui-row notify-row"><div><strong>Notifications on this device</strong><span class="ui-meta">${denied ? 'Notifications are blocked for this site in your browser settings. Allow them there, then come back.' : 'Get a phone or desktop alert for each Inbox message you have not muted.'}</span></div>
          <label class="switch"><input type="checkbox" role="switch" data-push-toggle ${subscription ? 'checked' : ''} ${denied ? 'disabled' : ''} aria-label="Notifications on this device"><span aria-hidden="true"></span></label></li>`;
    box.innerHTML = `<h3 class="notify-subtitle">This device</h3><ul class="ui-rows notify-list">${installRow}${pushRow}</ul><p class="ui-meta" role="status" data-push-status></p>`;
    const say = (text) => { const node = box.querySelector('[data-push-status]'); if (node) node.textContent = text; };
    box.querySelector('[data-app-install]')?.addEventListener('click', async () => { const accepted = await app.install(); say(accepted ? 'Installing…' : 'Install cancelled.'); });
    box.querySelector('[data-push-toggle]')?.addEventListener('change', async (event) => {
      const input = event.currentTarget; input.disabled = true;
      try {
        if (input.checked) {
          if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications were not allowed.');
          const reg = await app.registration();
          say('Turning on…');
          const sub = await Promise.race([reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(info.publicKey) }),
            new Promise((resolve, reject) => setTimeout(() => reject(new Error('Your browser did not respond. Try again, or use another browser.')), 15000))]);
          await api('POST', sub.toJSON());
          say('Notifications are on for this device.');
        } else {
          const sub = await current();
          if (sub) { await api('DELETE', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
          say('Notifications are off for this device.');
        }
      } catch (error) { input.checked = !input.checked; say(error.message); }
      input.disabled = false;
    });
  }
  window.svuNotificationSettings?.register({ render });
})();
