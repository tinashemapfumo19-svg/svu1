(function () {
  // Settings → Notifications → Text messages (docs/SMS_NOTIFICATIONS.md). Opt-in: add a mobile number, confirm it with a
  // code, then urgent notices are also texted. Registers into the notification settings panel.
  const ui = window.svuUI, esc = ui.esc;
  async function api(method, path = '', body) {
    const response = await fetch(`/api/me/sms${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${window.svuSession.get()?.token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || 'Your text message settings could not be saved.');
    return payload.data;
  }

  async function render(host) {
    const box = document.createElement('div');
    box.className = 'notify-sms';
    host.append(box);
    let data, message = '', editing = false;
    try { data = await api('GET'); } catch { box.remove(); return; }
    if (!data.available) { box.remove(); return; }
    const paint = () => {
      const verified = data.verified && !editing;
      box.innerHTML = `<h3 class="notify-subtitle">Text messages</h3><p class="ui-meta">Get a text for urgent notices only: deadlines due within a day, offers about to expire, financial holds, cancelled appointments and examination timetables. Up to five a day.</p>
        ${verified ? `<ul class="ui-rows notify-list"><li class="ui-row notify-row"><div><strong>${esc(data.phone)}</strong><span class="ui-meta">Verified. ${data.enabled ? 'Urgent notices are texted to this number.' : 'Texts are off.'}</span></div>
            <label class="switch"><input type="checkbox" role="switch" data-sms-toggle ${data.enabled ? 'checked' : ''} aria-label="Text messages for urgent notices"><span aria-hidden="true"></span></label></li></ul>
            <div class="ui-actions"><button class="button button-secondary" type="button" data-sms-change>Change number</button><button class="button button-secondary" type="button" data-sms-remove>Remove number</button></div>`
          : data.codePending && !editing ? `<form class="sms-form" data-sms-verify><label class="field"><span>Enter the 6-digit code sent to ${esc(data.phone)}</span><input class="input sms-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label><div class="ui-actions"><button class="button button-primary" type="submit">Confirm</button><button class="button button-secondary" type="button" data-sms-change>Use another number</button></div></form>`
          : `<form class="sms-form" data-sms-request><label class="field"><span>Mobile number</span><input class="input" name="phone" type="tel" autocomplete="tel" placeholder="+263 77 123 4567" value="${esc(data.phone || '')}" required></label><div><button class="button button-primary" type="submit">Send code</button></div></form>`}
        <p class="ui-meta" role="status" data-sms-status>${esc(message)}</p>`;
      const run = async (work, done) => { try { data = await work(); editing = false; message = done; } catch (error) { message = error.message; } paint(); };
      box.querySelector('[data-sms-request]')?.addEventListener('submit', (event) => { event.preventDefault(); const phone = new FormData(event.currentTarget).get('phone'); run(() => api('POST', '/code', { phone }), 'Code sent. It expires in 10 minutes.'); });
      box.querySelector('[data-sms-verify]')?.addEventListener('submit', (event) => { event.preventDefault(); const code = new FormData(event.currentTarget).get('code'); run(() => api('POST', '/verify', { code }), 'Number verified. Urgent notices will be texted.'); });
      box.querySelector('[data-sms-toggle]')?.addEventListener('change', (event) => { const enabled = event.currentTarget.checked; run(() => api('PUT', '', { enabled }), enabled ? 'Texts are on.' : 'Texts are off.'); });
      box.querySelector('[data-sms-change]')?.addEventListener('click', () => { editing = true; message = ''; paint(); box.querySelector('[name=phone]')?.focus(); });
      box.querySelector('[data-sms-remove]')?.addEventListener('click', () => run(() => api('DELETE'), 'Number removed.'));
    };
    paint();
  }
  window.svuNotificationSettings?.register({ render });
})();
