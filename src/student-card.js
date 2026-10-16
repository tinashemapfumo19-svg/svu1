(function () {
  // Digital student ID (docs/STUDENT_CARD.md). Mounts into [data-student-card] on Student Office → ID Card.
  // The QR code is a short-lived signed link to the Verify page; it refreshes while the card is open, and a live
  // clock and moving shine make a screenshot easy to tell apart from the real card.
  const ui = window.svuUI, esc = ui.esc;
  let timer = null, clock = null;

  async function load() {
    const response = await fetch('/api/registry/me/card', { headers: { Authorization: `Bearer ${window.svuSession.get()?.token}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || 'Your card could not be loaded.');
    return payload.data;
  }
  const statusText = { active: 'Current student', onboarded: 'Current student' };

  function render(host, card) {
    host.innerHTML = `<div class="id-wrap">
      <article class="id-card" aria-label="Student ID card for ${esc(card.legalName)}">
        <header class="id-card-head"><span class="brand-mark id-mark">SVU</span><div><strong>South Valley University</strong><span>Student identity card</span></div></header>
        <div class="id-card-body">
          <div class="id-photo" aria-hidden="true">${esc(ui.initials(card.legalName))}</div>
          <div class="id-facts"><p class="id-name">${esc(card.legalName)}</p><p class="id-number">${esc(card.studentNumber)}</p>
            <p class="id-programme">${esc(card.programmeName)}</p><p class="id-meta">${esc(card.intakeLabel)} intake${card.faculty ? ` · ${esc(card.faculty)}` : ''}</p>
            <span class="id-status"><i aria-hidden="true"></i>${esc(statusText[card.status] || ui.sentence(card.status))}</span></div>
          <div class="id-qr" role="img" aria-label="QR code to verify this card">${card.qrSvg}</div>
        </div>
        <footer class="id-card-foot"><span data-id-clock></span><span data-id-refresh></span></footer>
      </article>
      <div class="id-help ui-panel">${ui.head('Using your card', { desc: 'Show this screen when asked for student ID. Staff, libraries or exam invigilators scan the QR code to check, on the university site, that you are a current student.' })}
        <ul class="id-points"><li>The code refreshes every few minutes, so screenshots stop working.</li><li>A scan shows only what the card shows: your name, number, programme and whether you are current.</li><li>Add the portal to your home screen to open your card quickly.</li></ul>
        <div><button class="button button-secondary" type="button" data-id-reload>Refresh code now</button></div></div>
    </div>`;
    host.querySelector('[data-id-reload]').addEventListener('click', () => start(host));
    const expires = new Date(card.expiresAt).getTime();
    const tick = () => {
      if (!host.isConnected) { clearInterval(clock); return; }
      const now = new Date();
      host.querySelector('[data-id-clock]').textContent = now.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const left = Math.max(0, Math.round((expires - now) / 1000));
      host.querySelector('[data-id-refresh]').textContent = left ? `Code valid ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Code expired · refreshing';
    };
    clearInterval(clock); clock = setInterval(tick, 1000); tick();
    clearTimeout(timer); timer = setTimeout(() => { if (host.isConnected) start(host); }, card.refreshSeconds * 1000);
  }

  async function start(host) {
    try { render(host, await load()); }
    catch (error) { host.innerHTML = ui.emptyState({ glyph: 'user', title: 'Student card unavailable', text: error.message }); }
  }
  const scan = () => document.querySelectorAll('[data-student-card]:not([data-mounted])').forEach((host) => { host.dataset.mounted = '1'; host.innerHTML = '<p class="ui-meta" role="status">Loading your card…</p>'; start(host); });
  new MutationObserver(() => requestAnimationFrame(scan)).observe(document.querySelector('#app'), { childList: true, subtree: true });
})();
