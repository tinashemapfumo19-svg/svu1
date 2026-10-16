(function () {
  // Online fee payments on Student Office → Fees & Payments (docs/ONLINE_PAYMENTS.md). Mounts into [data-online-payments].
  // Starts a checkout, sends the student to the provider, and on return follows the payment until it settles.
  const ui = window.svuUI, esc = ui.esc;
  async function api(method, path, body) {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${window.svuSession.get()?.token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || 'Request failed.');
    return payload.data;
  }
  const money = (currency, minor) => `${currency} ${(Number(minor) / 100).toFixed(2)}`;
  const params = () => new URLSearchParams(location.hash.split('?')[1] || '');
  const statusText = { created: 'Starting', pending: 'Waiting for the provider', paid: 'Paid', failed: 'Failed', cancelled: 'Cancelled', expired: 'Expired' };
  const tone = { paid: 'green', failed: 'red', cancelled: 'amber', expired: 'amber' };

  async function mount(host) {
    const programme = host.dataset.programme;
    let list, account;
    try {
      [list, account] = await Promise.all([api('GET', `/api/registry/me/programmes/${encodeURIComponent(programme)}/payments`), api('GET', `/api/registry/me/programmes/${encodeURIComponent(programme)}/account`)]);
    } catch { host.remove(); return; }
    if (!list.enabled) { host.remove(); return; }
    document.querySelector('[data-pay-unavailable]')?.remove();
    const owing = account.currencies.filter((row) => row.balance > 0);
    const simulate = params().get('simulate'), returning = params().get('payment');
    let watched = returning || simulate ? (list.items.find((row) => row.id === (returning || simulate)) || null) : null;
    let error = '';
    const initialStatus = watched?.status;

    const paint = () => {
      host.innerHTML = `${ui.head('Pay online', { desc: list.provider === 'simulated' ? 'Development mode: payments are simulated and no money moves.' : 'Pay by card or mobile money through our payment provider. The payment shows on your statement once the provider confirms it.' })}
        ${error ? ui.alert('error', 'Payment', error) : ''}
        ${simulate && watched && ['created', 'pending'].includes(watched.status) ? `<div class="pay-sim ai-card"><p><strong>Simulated payment provider</strong></p><p>Pay ${esc(money(watched.currency, watched.amountMinor))} to South Valley University?</p>
            <div class="ai-card-actions"><button class="button button-primary" type="button" data-pay-sim="paid">Pay</button><button class="button button-secondary" type="button" data-pay-sim="cancelled">Cancel</button><button class="button button-secondary" type="button" data-pay-sim="failed">Decline</button></div></div>` : ''}
        ${watched && !simulate ? `<div class="pay-status is-${esc(watched.status)}" role="status">${watched.status === 'paid' ? ui.illustration('success', { cls: 'pay-art' }) : ui.ico( ['failed', 'cancelled', 'expired'].includes(watched.status) ? 'alert' : 'clock', tone[watched.status] || 'blue', 'ui-icon-lg')}<div><strong>${esc(statusText[watched.status])}: ${esc(money(watched.currency, watched.amountMinor))}</strong><span class="ui-meta">${watched.status === 'paid' ? `Receipt ${esc(watched.receiptNumber)}. Your statement is updated.` : watched.status === 'pending' ? 'This page updates when the provider confirms.' : esc(watched.detail || 'No money was taken.')}</span></div></div>` : ''}
        ${owing.length ? `<form class="pay-form" data-pay-form><label class="field"><span>Amount</span><input class="input" type="number" name="amount" min="1" step="0.01" max="${(owing[0].balance / 100).toFixed(2)}" value="${((owing[0].due > 0 ? owing[0].due : owing[0].balance) / 100).toFixed(2)}" required></label>
            <label class="field"><span>Currency</span><select class="input" name="currency">${owing.map((row) => `<option value="${esc(row.currency)}">${esc(row.currency)} · balance ${esc(money(row.currency, row.balance))}</option>`).join('')}</select></label>
            <div><button class="button button-primary" type="submit">Pay online</button></div></form>` : '<p class="ui-meta">You have nothing to pay right now.</p>'}
        ${list.items.length ? `<details class="pay-history"><summary>Recent online payments</summary><ul class="ui-rows">${list.items.map((row) => `<li class="ui-row"><div><strong>${esc(money(row.currency, row.amountMinor))}</strong><span class="ui-meta">${esc(window.svuUI.dateTime(row.createdAt))}${row.receiptNumber ? ` · ${esc(row.receiptNumber)}` : ''}</span></div>${ui.badge(statusText[row.status], tone[row.status] || 'blue')}</li>`).join('')}</ul></details>` : ''}`;
      host.querySelector('[data-pay-form]')?.addEventListener('submit', async (event) => {
        event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); const button = event.currentTarget.querySelector('button'); button.disabled = true;
        try { const started = await api('POST', `/api/registry/me/programmes/${encodeURIComponent(programme)}/payments/checkout`, { currency: values.currency, amountMinor: Math.round(Number(values.amount) * 100) }); location.assign(started.redirectUrl); }
        catch (e) { error = e.message; paint(); }
      });
      host.querySelectorAll('[data-pay-sim]').forEach((button) => button.addEventListener('click', async () => {
        try { await api('POST', `/api/payments/${watched.id}/simulate`, { outcome: button.dataset.paySim }); } catch (e) { error = e.message; }
        location.replace(`#office/fees?payment=${watched.id}`);
      }));
    };
    paint();
    // Follow a returning payment until it settles (up to about two minutes), then reload the page's figures.
    if (returning && watched && !['paid', 'failed', 'cancelled', 'expired'].includes(watched.status)) {
      for (let tries = 0; tries < 40 && host.isConnected; tries++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        try { watched = await api('GET', `/api/payments/${returning}`); } catch { break; }
        paint();
        if (['paid', 'failed', 'cancelled', 'expired'].includes(watched.status)) break;
      }
    }
    // Reload the statement once, only when the payment settled while this page was open.
    if (returning && watched?.status === 'paid' && initialStatus !== 'paid') window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  const scan = () => document.querySelectorAll('[data-online-payments]:not([data-mounted])').forEach((host) => { host.dataset.mounted = '1'; mount(host); });
  new MutationObserver(() => requestAnimationFrame(scan)).observe(document.querySelector('#app'), { childList: true, subtree: true });
})();
