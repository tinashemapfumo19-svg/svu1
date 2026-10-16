(function () {
  // Settings → Notifications (docs/NOTIFICATION_PREFERENCES.md). Mounts into [data-settings-notifications].
  // Each switch saves immediately. Essential messages are listed but cannot be turned off.
  const ui = window.svuUI, esc = ui.esc;
  const extras = []; // Other panels (push, SMS) register here to add their rows: { render(host), bind(host) }.
  window.svuNotificationSettings = { register: (extra) => extras.push(extra) };

  async function api(method, body) {
    const response = await fetch('/api/me/notification-preferences', { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${window.svuSession.get()?.token}` }, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || 'Your notification settings could not be saved.');
    return payload.data;
  }

  function paint(host, data, status = '') {
    host.innerHTML = `<h2 class="ui-section-title">Notifications</h2>
      <p class="ui-meta">Choose which optional messages you receive in your Inbox and by email.</p>
      <ul class="ui-rows notify-list">${data.groups.map((group) => `<li class="ui-row notify-row"><div><strong>${esc(group.label)}</strong><span class="ui-meta">${esc(group.detail)}</span></div>
        <label class="switch"><input type="checkbox" role="switch" data-notify-group="${esc(group.id)}" ${group.enabled ? 'checked' : ''} aria-label="${esc(group.label)}"><span aria-hidden="true"></span></label></li>`).join('')}
        <li class="ui-row notify-row is-locked"><div><strong>Essential messages</strong><span class="ui-meta">Submission receipts, financial holds, offers, results, examination notices and security alerts are always sent.</span></div>${ui.ico('lock', '', 'ui-icon-sm')}</li></ul>
      <div data-notify-extras></div>
      <p class="ui-meta" role="status" data-notify-status>${esc(status)}</p>`;
    host.querySelectorAll('[data-notify-group]').forEach((input) => input.addEventListener('change', async () => {
      input.disabled = true;
      try { const saved = await api('PUT', { groups: { [input.dataset.notifyGroup]: input.checked } }); paint(host, saved, `${input.checked ? 'Turned on' : 'Muted'}: ${input.getAttribute('aria-label')}.`); host.querySelector(`[data-notify-group="${input.dataset.notifyGroup}"]`)?.focus(); }
      catch (error) { input.checked = !input.checked; input.disabled = false; host.querySelector('[data-notify-status]').textContent = error.message; }
    }));
    const extraHost = host.querySelector('[data-notify-extras]');
    for (const extra of extras) extra.render(extraHost);
  }

  async function mount(host) {
    host.innerHTML = '<h2 class="ui-section-title">Notifications</h2><p class="ui-meta" role="status">Loading…</p>';
    try { paint(host, await api('GET')); } catch (error) { host.innerHTML = `<h2 class="ui-section-title">Notifications</h2>${ui.alert('error', 'Notification settings unavailable', error.message)}`; }
  }
  const scan = () => document.querySelectorAll('[data-settings-notifications]:not([data-mounted])').forEach((host) => { host.dataset.mounted = '1'; mount(host); });
  new MutationObserver(() => requestAnimationFrame(scan)).observe(document.querySelector('#app'), { childList: true, subtree: true });
})();
