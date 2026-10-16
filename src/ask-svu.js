(function () {
  // Ask SVU (docs/ASK_SVU.md): a floating help guide for using the portal. It answers from the pages the person can
  // open and published guidance, links to those pages, cannot see personal records and never takes actions.
  // Shown only when AI assistance is enabled. The conversation lives in this tab for the current session only.
  const ui = window.svuUI, esc = ui.esc;
  const storeKey = "svu.askSvu";
  const session = () => window.svuSession.get();
  const token = () => session()?.token || "";
  const can = (code) => window.svuSession.can(code);
  const firstName = () => { const person = window.svuSession.cached()?.person; return String(person?.preferredName || person?.legalName || "").split(" ")[0]; };
  const sparkle = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></svg>';
  const close = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const send = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12h14M13 6l6 6-6 6"/></svg>';

  let state = load(), open = false, busy = false, launcher = null, panel = null, personal = false;
  function load() {
    try { const saved = JSON.parse(sessionStorage.getItem(storeKey) || "null"); if (saved && saved.token === token()) return saved; } catch { /* storage unavailable */ }
    return { token: token(), messages: [] };
  }
  function save() { try { sessionStorage.setItem(storeKey, JSON.stringify({ ...state, messages: state.messages.slice(-20) })); } catch { /* storage unavailable */ } }
  // A different (or no) session starts a fresh conversation, so nothing carries across sign-out.
  function checkSession() { if (state.token !== token()) { state = { token: token(), messages: [] }; save(); } }

  function starters() {
    if (!session()) return ["How do I apply?", "Which documents do I need?", "How do I verify a certificate?"];
    if (can("registry.self")) return personal ? ["What is due this week?", "Do I owe anything?", "How do I register for courses?"] : ["Where do I see my fees?", "How do I submit an assignment?", "How do I register for courses?"];
    if (can("admissions.apply")) return ["How do I upload my documents?", "How do I accept an offer?", "Where do I see my application status?"];
    if (can("teaching.self")) return ["How do I mark and release feedback?", "How do I remind students who have not submitted?", "How do I add deadlines to my calendar?"];
    return personal ? ["What is waiting for me this week?", "Where do I find a student record?", "How do I turn on two-step verification?"] : ["Where do I find a student record?", "How do I turn on two-step verification?", "Where are my notifications?"];
  }

  const linkButton = (link) => link.external
    ? `<a class="ask-link" href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(link.title)} <span class="ask-link-icon" aria-hidden="true">${ui.icons.external}</span><span class="visually-hidden"> (opens in a new tab)</span></a>`
    : `<a class="ask-link" href="${esc(link.href)}" data-ask-nav>${esc(link.title)} <span class="ask-link-icon" aria-hidden="true">${ui.icons.arrowRight}</span></a>`;
  function message(row, index) {
    if (row.role === "user") return `<li class="ask-msg is-user"><p>${esc(row.text)}</p></li>`;
    if (row.role === "error") return `<li class="ask-msg is-error" role="alert"><p>${esc(row.text)}</p><button class="button button-secondary" type="button" data-ask-retry>Try again</button></li>`;
    const last = index === state.messages.length - 1;
    return `<li class="ask-msg is-assistant"><span class="ai-sparkle">${sparkle}</span><div class="ask-bubble">
      ${row.personal ? '<span class="ask-personal">From your portal record</span>' : ""}<p>${esc(row.text)}</p>
      ${row.links?.length ? `<div class="ask-links">${row.links.map(linkButton).join("")}</div>` : ""}
      ${row.articles?.length ? `<p class="ui-meta">From: ${row.articles.map((article) => esc(article.title)).join(", ")}</p>` : ""}
      ${!row.answered && session() ? `<div class="ask-links"><a class="ask-link" href="${can("registry.self") ? "#office/requests" : "#messages"}" data-ask-nav>${can("registry.self") ? "Open a request" : "Go to Inbox"} <span class="ask-link-icon" aria-hidden="true">${ui.icons.arrowRight}</span></a></div>` : ""}
      ${!row.answered && !session() ? `<div class="ask-links"><a class="ask-link" href="#apply" data-ask-nav>Send an enquiry <span class="ask-link-icon" aria-hidden="true">${ui.icons.arrowRight}</span></a></div>` : ""}
      ${session() && row.rated === undefined ? `<div class="ask-rate" role="group" aria-label="Was this helpful?"><span class="ui-meta">Helpful?</span><button type="button" data-ask-rate="${index}" data-helpful="true" aria-label="Yes, helpful">${ui.icons.thumbUp}</button><button type="button" data-ask-rate="${index}" data-helpful="false" aria-label="No, not helpful">${ui.icons.thumbDown}</button></div>` : ""}
      ${row.rated !== undefined ? '<p class="ui-meta">Thanks for the feedback.</p>' : ""}
      ${last && row.followUps?.length ? `<div class="ask-chips">${row.followUps.map((text) => `<button type="button" class="ask-chip" data-ask-suggest="${esc(text)}">${esc(text)}</button>`).join("")}</div>` : ""}
    </div></li>`;
  }
  function render() {
    if (!panel) return;
    const list = panel.querySelector("[data-ask-list]");
    list.innerHTML = state.messages.length ? state.messages.map(message).join("") + (busy ? `<li class="ask-msg is-assistant is-typing" aria-label="Ask SVU is answering"><span class="ai-sparkle">${sparkle}</span><div class="ask-bubble"><span class="ai-shimmer"></span><span class="ai-shimmer is-short"></span></div></li>` : "")
      : `<li class="ask-intro"><span class="ai-sparkle is-large">${sparkle}</span><strong>Hi${firstName() ? `, ${esc(firstName())}` : ""}! How can I help?</strong><p class="ui-meta">I can explain how to do things in the portal and take you to the right page.</p><div class="ask-chips">${starters().map((text) => `<button type="button" class="ask-chip" data-ask-suggest="${esc(text)}">${esc(text)}</button>`).join("")}</div></li>`;
    panel.querySelector("[data-ask-new]").hidden = !state.messages.length;
    panel.querySelector("[data-ask-send]").disabled = busy;
    list.scrollTop = list.scrollHeight;
  }

  async function call(path, body) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}) }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || "Ask SVU is unavailable right now.");
    return payload.data;
  }
  async function ask(question) {
    checkSession();
    question = question.trim();
    if (!question || busy) return;
    state.messages = state.messages.filter((row) => row.role !== "error");
    const history = state.messages.slice(-6).map((row) => ({ role: row.role, text: row.text }));
    state.messages.push({ role: "user", text: question }); busy = true; save(); render();
    try {
      const result = await call("/api/help/ask", { question, history, path: location.hash.slice(0, 120) });
      state.messages.push({ role: "assistant", text: result.answer, answered: result.answered, links: result.links, articles: result.articles, followUps: result.followUps, personal: result.personal });
    } catch (error) { state.messages.push({ role: "error", text: error.message, retry: question }); }
    busy = false; save(); render();
    panel?.querySelector("[data-ask-input]")?.focus();
  }

  function setOpen(value) {
    open = value;
    checkSession();
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.classList.toggle("is-open", open);
    document.documentElement.classList.toggle("ask-svu-open", open);
    const note = panel.querySelector("[data-ask-note]");
    if (note) note.textContent = personal && session() ? "AI answers from SVU help pages, published guidance and a read-only summary of your own dates, fees and work. Check important details on the page it links to." : "AI answers from SVU help pages and published guidance. It cannot see your records; check important details.";
    if (open) { render(); panel.querySelector("[data-ask-input]").focus(); if (session() && !window.svuSession.cached()) window.svuSession.me().then(render); } else launcher.focus();
  }

  function mount() {
    if (launcher) return;
    document.body.insertAdjacentHTML("beforeend", `<button class="ask-launcher" type="button" data-ask-launcher aria-expanded="false" aria-controls="ask-svu-panel">${sparkle}<span>Ask SVU</span></button>
      <section class="ask-panel" id="ask-svu-panel" role="dialog" aria-modal="false" aria-labelledby="ask-svu-title" hidden>
        <header class="ask-head"><span class="ai-sparkle">${sparkle}</span><div><h2 id="ask-svu-title">Ask SVU</h2><p class="ui-meta">Help with using the portal</p></div>
          <button class="ask-text-button" type="button" data-ask-new hidden>New chat</button><button class="ask-icon-button" type="button" data-ask-close aria-label="Close Ask SVU">${close}</button></header>
        <ol class="ask-list" data-ask-list aria-live="polite"></ol>
        <form class="ask-form" data-ask-form><label class="visually-hidden" for="ask-svu-input">Ask a question</label>
          <textarea id="ask-svu-input" class="input" data-ask-input rows="1" maxlength="500" placeholder="Ask how to do something..."></textarea>
          <button class="button button-primary ask-send" type="submit" data-ask-send aria-label="Send">${send}</button></form>
        <p class="ask-note" data-ask-note>AI answers from SVU help pages and published guidance. It cannot see your records; check important details.</p>
      </section>`);
    launcher = document.querySelector("[data-ask-launcher]"); panel = document.querySelector("#ask-svu-panel");
    launcher.addEventListener("click", () => setOpen(!open));
    panel.querySelector("[data-ask-close]").addEventListener("click", () => setOpen(false));
    panel.querySelector("[data-ask-new]").addEventListener("click", () => { state.messages = []; save(); render(); panel.querySelector("[data-ask-input]").focus(); });
    const input = panel.querySelector("[data-ask-input]");
    panel.querySelector("[data-ask-form]").addEventListener("submit", (event) => { event.preventDefault(); const value = input.value; input.value = ""; input.style.height = ""; ask(value); });
    input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); panel.querySelector("[data-ask-form]").requestSubmit(); } });
    input.addEventListener("input", () => { input.style.height = ""; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; });
    panel.addEventListener("keydown", (event) => { if (event.key === "Escape") setOpen(false); });
    panel.addEventListener("click", (event) => {
      const suggest = event.target.closest("[data-ask-suggest]"); if (suggest) { ask(suggest.dataset.askSuggest); return; }
      const retry = event.target.closest("[data-ask-retry]"); if (retry) { const failed = state.messages.find((row) => row.role === "error"); const last = [...state.messages].reverse().find((row) => row.role === "user"); state.messages = state.messages.filter((row) => row !== failed && row !== last); ask(failed?.retry || last?.text || ""); return; }
      const rate = event.target.closest("[data-ask-rate]");
      if (rate) { const row = state.messages[Number(rate.dataset.askRate)]; if (row) { row.rated = rate.dataset.helpful === "true"; save(); render(); call("/api/help/feedback", { helpful: row.rated }).catch(() => {}); } return; }
      // On narrow screens the panel covers the page, so close it when following a link.
      if (event.target.closest("[data-ask-nav]") && window.matchMedia("(max-width: 860px)").matches) setOpen(false);
    });
  }

  // Mount once AI assistance is confirmed on; re-check when the session changes (sign-in may switch it on).
  let lastToken = null;
  const sync = () => { if (token() === lastToken && launcher) return; lastToken = token(); ui.aiDetails().then((status) => { const enabled = Boolean(status.enabled); personal = Boolean(status.askSvuPersonal); if (enabled) mount(); if (launcher) { launcher.hidden = !enabled; checkSession(); if (open) render(); } }); };
  sync();
  window.svuSession.onChange(sync);
  window.addEventListener("hashchange", sync);
})();
