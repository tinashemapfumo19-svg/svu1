(function () {
  // Assistive AI controls (docs/AI_ASSIST.md) and the early-warning list. Controls are added after a screen renders,
  // only when assistance is enabled; every suggestion is shown for a person to review and is never saved by itself.
  const ui = window.svuUI, esc = ui.esc;
  const token = () => window.svuSession.get()?.token;
  async function call(method, path, body) {
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || "Request failed.");
    return payload.data;
  }
  const readFile = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ fileName: file.name, base64: reader.result.split(",")[1] }); reader.onerror = () => reject(new Error("The file could not be read.")); reader.readAsDataURL(file); });
  const busy = async (button, label, work) => { const original = button.textContent; button.disabled = true; button.textContent = label; try { return await work(); } finally { button.disabled = false; button.textContent = original; } };
  const sparkle = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></svg>';

  // One look for every suggestion: a lavender card with a sparkle, the content, then Use this / Dismiss.
  const card = (body, { title = "Suggestion", use = "", extra = "" } = {}) => `<div class="ai-card" role="status"><div class="ai-card-head"><span class="ai-sparkle">${sparkle}</span><strong>${esc(title)}</strong></div><div class="ai-card-body">${body}</div><div class="ai-card-actions">${use ? `<button class="button button-primary" type="button" data-ai-use>${esc(use)}</button>` : ""}${extra}<button class="button button-secondary" type="button" data-ai-dismiss>Dismiss</button></div><span class="ui-meta">${esc(ui.aiNote)}</span></div>`;
  const loading = (label) => `<div class="ai-card is-loading" role="status" aria-live="polite"><div class="ai-card-head"><span class="ai-sparkle">${sparkle}</span><strong>${esc(label)}</strong></div><span class="ai-shimmer"></span><span class="ai-shimmer"></span><span class="ai-shimmer is-short"></span></div>`;
  const errorBox = (message) => `<div class="ui-alert ui-alert-error" role="alert"><div><strong>${esc(message)}</strong></div></div>`;
  async function suggest(out, button, label, work) {
    button.disabled = true; out.innerHTML = loading(label);
    try { await work(); } catch (error) { out.innerHTML = errorBox(error.message); } finally { button.disabled = false; }
    out.querySelector("[data-ai-dismiss]")?.addEventListener("click", () => { out.innerHTML = ""; button.focus(); });
  }

  // 9. Lecturer review form: draft feedback from the mark, notes and submission, shown beside the lecturer's notes.
  function feedback(root) {
    root.querySelectorAll("[data-course-review]:not([data-ai-ready])").forEach((form) => {
      form.dataset.aiReady = "1";
      const workspace = form.closest("[data-course-workspace]"), box = form.elements.feedback?.closest(".field");
      if (!workspace || !box) return;
      box.insertAdjacentHTML("afterend", `<div class="ai-tool"><button class="button button-secondary ai-trigger" type="button" data-ai-feedback>${sparkle}Draft feedback with AI</button><div data-ai-feedback-result></div></div>`);
      const button = form.querySelector("[data-ai-feedback]"), out = form.querySelector("[data-ai-feedback-result]");
      button.addEventListener("click", () => suggest(out, button, "Drafting feedback...", async () => {
        const notes = form.elements.feedback.value;
        const result = await call("POST", `/api/course-workspaces/${encodeURIComponent(workspace.dataset.period)}/${encodeURIComponent(workspace.dataset.course)}/resources/${encodeURIComponent(form.dataset.resource)}/feedback-draft`,
          { submissionId: form.dataset.submission, mark: form.elements.mark.value === "" ? null : Number(form.elements.mark.value), maxMark: Number(form.elements.maxMark.value), notes });
        out.innerHTML = card(`<div class="ai-compare"><div><span class="ui-label">Your notes</span><p>${notes.trim() ? esc(notes) : '<span class="ui-meta">No notes yet.</span>'}</p></div><div><span class="ui-label">Suggested feedback</span><p class="ai-reply">${esc(result.draft)}</p></div></div>`, { title: "Suggested feedback", use: "Use this" });
        out.querySelector("[data-ai-use]").onclick = () => { form.elements.feedback.value = result.draft; form.elements.feedback.focus(); out.innerHTML = `<p class="ui-meta ai-used">${sparkle}Draft placed in the feedback box. Edit it, then save; it is not released until you choose to.</p>`; };
      }));
    });
  }

  // 10. Staff support case: suggested category, priority and reply.
  function support(root) {
    root.querySelectorAll(".registry-workspace [data-support-detail]:not([data-ai-ready])").forEach((detail) => {
      detail.dataset.aiReady = "1";
      const comment = detail.querySelector('[data-support-action="comment"]');
      if (!comment) return;
      comment.insertAdjacentHTML("beforebegin", `<div class="ai-tool"><button class="button button-secondary ai-trigger" type="button" data-ai-triage>${sparkle}Suggest triage and reply</button><div data-ai-triage-result></div></div>`);
      const button = detail.querySelector("[data-ai-triage]"), out = detail.querySelector("[data-ai-triage-result]");
      button.addEventListener("click", () => suggest(out, button, "Reading the case...", async () => {
        const result = await call("POST", `/api/support/cases/${encodeURIComponent(detail.dataset.supportDetail)}/assist`);
        out.innerHTML = card(`<p><strong>${esc(result.summary)}</strong></p><div class="ai-chips"><span class="ew-chip is-info">Category: ${esc(ui.sentence(result.category))}</span><span class="ew-chip is-info">Priority: ${esc(ui.sentence(result.priority))}</span></div><p class="ai-reply">${esc(result.suggestedReply)}</p>${result.guidance.length ? `<span class="ui-meta">Based on: ${result.guidance.map((row) => esc(row.title)).join(", ")}</span>` : ""}`, { title: "Suggested triage", use: "Use this reply" });
        out.querySelector("[data-ai-use]").onclick = () => { const body = comment.querySelector('[name="body"]'); if (body) { body.value = result.suggestedReply; body.focus(); } };
      }));
    });
  }

  // 11. Public guidance: ask a question answered only from published articles.
  function guidance(root) {
    root.querySelectorAll("[data-guidance-public]:not([data-ai-ready])").forEach((section) => {
      section.dataset.aiReady = "1";
      const search = section.querySelector("[data-guidance-search]");
      if (!search) return;
      search.insertAdjacentHTML("beforebegin", `<form class="ai-ask" data-ai-ask><label class="field"><span>Ask a question about applying</span><input class="input" name="question" maxlength="500" required placeholder="For example: which documents do I need?"></label><div><button class="button button-primary" type="submit">Ask</button></div><div data-ai-ask-result></div></form>`);
      const form = section.querySelector("[data-ai-ask]"), out = form.querySelector("[data-ai-ask-result]");
      form.addEventListener("submit", (event) => { event.preventDefault(); suggest(out, form.querySelector("button"), "Looking it up...", async () => {
        const result = await call("POST", "/api/guidance/ask", { question: form.elements.question.value });
        out.innerHTML = card(`<p>${esc(result.answer)}</p>${result.articles.length ? `<span class="ui-meta">Sources: ${result.articles.map((row) => esc(row.title)).join(", ")}</span>` : ""}`, { title: "Answer", extra: result.answered ? "" : '<a class="button button-secondary" href="#apply">Send an enquiry to admissions</a>' });
      }); });
    });
  }

  // 12. Applicant uploads: check the document type first; warn in the row, but let the applicant decide.
  document.addEventListener("change", async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches("input[data-upload][data-application]") || input.dataset.aiChecked === "1" || !input.files?.[0] || !/\.(pdf|png|jpe?g)$/i.test(input.files[0].name)) return;
    // Hold the upload synchronously; it is re-dispatched below once the check (if any) is done.
    event.stopImmediatePropagation();
    const release = () => { input.dataset.aiChecked = "1"; input.dispatchEvent(new Event("change", { bubbles: true })); delete input.dataset.aiChecked; };
    if (!(await ui.aiEnabled())) { release(); return; }
    const row = input.closest(".file-row") || input.parentElement;
    row?.querySelector("[data-ai-doc-check]")?.remove();
    row?.setAttribute("aria-busy", "true");
    let result = null;
    try { result = await call("POST", `/api/admissions/applications/${encodeURIComponent(input.dataset.application)}/document-check`, { documentType: input.dataset.upload === "other" ? "supporting_document" : input.dataset.upload, file: await readFile(input.files[0]) }); }
    catch { /* If the check is unavailable, the upload continues as before. */ }
    row?.removeAttribute("aria-busy");
    if (!result?.checked || (result.matches && result.readable) || !row) { release(); return; }
    row.insertAdjacentHTML("beforeend", `<div class="ai-doc-check" data-ai-doc-check role="alert"><span class="ai-sparkle">${sparkle}</span><div><strong>This file looks like ${esc(result.detectedType || "a different document")}${result.readable ? "" : " and may be hard to read"}.</strong>${result.note ? `<span class="ui-meta">${esc(result.note)}</span>` : ""}<div class="ai-card-actions"><button class="button button-secondary" type="button" data-ai-doc="choose">Choose another file</button><button class="button button-secondary" type="button" data-ai-doc="upload">Upload anyway</button></div></div></div>`);
    const panel = row.querySelector("[data-ai-doc-check]");
    panel.querySelector('[data-ai-doc="upload"]').onclick = () => { panel.remove(); release(); };
    panel.querySelector('[data-ai-doc="choose"]').onclick = () => { panel.remove(); input.value = ""; input.click(); };
  }, true);

  // 13. Student results: a plain-language explanation of the published record.
  async function programmeId() {
    const fromHash = new URLSearchParams(location.hash.split("?")[1] || "").get("programme");
    if (fromHash) return fromHash;
    return (await call("GET", "/api/registry/me")).programmes?.[0]?.id;
  }
  function explain(root) {
    if (!location.hash.startsWith("#study/results")) return;
    const host = root.querySelector("[data-student-controls]") || root.querySelector(".student-experience");
    if (!host || host.querySelector("[data-ai-explain]")) return;
    const content = host.querySelector(".ui-stack") || host;
    content.insertAdjacentHTML("afterbegin", `<section class="ui-panel" data-ai-explain>${ui.head("What do my results mean?", { desc: "A plain-language explanation of your published results and academic decisions." })}<div><button class="button button-secondary ai-trigger" type="button" data-ai-explain-run>${sparkle}Explain in plain language</button></div><div data-ai-explain-result></div></section>`);
    const button = host.querySelector("[data-ai-explain-run]"), out = host.querySelector("[data-ai-explain-result]");
    const show = (target, html) => { target.innerHTML = html; target.querySelector("[data-ai-dismiss]")?.addEventListener("click", () => { target.innerHTML = ""; explainCache = null; }); };
    if (explainCache?.key === `${token()}|${location.hash}`) show(out, explainCache.html);
    button.addEventListener("click", () => suggest(out, button, "Explaining...", async () => {
      const result = await call("POST", `/api/registry/me/programmes/${encodeURIComponent(await programmeId())}/explain`);
      const html = card(`<p>${esc(result.summary)}</p>${result.nextSteps.length ? `<ul class="ai-steps">${result.nextSteps.map((step) => `<li>${esc(step)}</li>`).join("")}</ul>` : ""}<span class="ui-meta">Your official record above is what counts.</span>`, { title: "In plain language" });
      explainCache = { key: `${token()}|${location.hash}`, html };
      // The results page can re-render while the request runs; write to whichever panel is on screen now.
      const live = document.querySelector("[data-ai-explain-result]");
      if (live && live !== out) show(live, html);
      out.innerHTML = html;
    }));
  }
  let explainCache = null; // the last explanation, redrawn if the results page re-renders

  // 14. Early warning (rules only, no AI): shown in the staff Students area on request, with chips and record links.
  const outcomeText = { contacted: "Contacted the student", meeting_booked: "Meeting booked", referred: "Referred to a service", no_action: "No action needed" };
  const reasonTone = { low_attendance: "is-warning", financial_hold: "is-blocked", missing_work: "is-warning", low_marks: "is-warning", support_waiting: "is-info", not_registered: "is-info" };
  function openRecord(item) {
    const filter = document.querySelector("[data-registry-filter]");
    if (!filter) return;
    filter.elements.q.value = item.studentNumber;
    filter.requestSubmit();
    const started = Date.now();
    // The registry ignores clicks while it is loading, so keep asking for the record until it shows as selected.
    const find = () => {
      const button = document.querySelector(`[data-registry-detail="${CSS.escape(item.programmeId)}"]`);
      if (button?.getAttribute("aria-current") === "true") { button.scrollIntoView({ block: "center" }); return; }
      if (button) button.click();
      if (Date.now() - started < 15000) setTimeout(find, 300);
    };
    setTimeout(find, 300);
  }
  let ewCache = null; // keeps the list on screen when opening a record re-renders the page
  function earlyWarning(root) {
    const body = root.querySelector('[data-staff-body="students"]');
    if (!body || body.querySelector("[data-early-warning]") || !window.svuSession.can("registry.view")) return;
    body.insertAdjacentHTML("beforeend", `<section class="ui-panel" data-early-warning>${ui.head("Students who may need support", { desc: "Advisory: missed assignments, low released marks, financial holds, support cases waiting, or no registration in an open period. Use it to offer help, not as a judgement." })}<div><button class="button button-secondary" type="button" data-early-warning-run>Show list</button></div><div data-early-warning-result></div></section>`);
    const button = body.querySelector("[data-early-warning-run]"), out = body.querySelector("[data-early-warning-result]");
    let items = [], sort = "reasons", openForm = null;
    const draw = () => {
      const byReasons = (a, b) => b.reasons.length - a.reasons.length || a.studentName.localeCompare(b.studentName);
      const sorted = [...items].sort(sort === "name" ? (a, b) => a.studentName.localeCompare(b.studentName) : sort === "pending" ? (a, b) => Number(Boolean(a.lastFollowUp)) - Number(Boolean(b.lastFollowUp)) || byReasons(a, b) : byReasons);
      const followed = (row) => row.lastFollowUp ? `<span class="ew-followed">${ui.ico("check", "green", "ui-icon-sm")}${esc(outcomeText[row.lastFollowUp.outcome])} · ${esc(ui.date(row.lastFollowUp.at))}${row.lastFollowUp.by ? ` · ${esc(row.lastFollowUp.by)}` : ""}${row.lastFollowUp.note ? `<span class="ui-meta">${esc(row.lastFollowUp.note)}</span>` : ""}</span>` : "";
      const form = (row) => `<form class="ew-followup" data-ew-form="${esc(row.programmeId)}"><label class="field"><span>Outcome</span><select class="input" name="outcome">${Object.entries(outcomeText).map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join("")}</select></label>
        <label class="field"><span>Note (optional)</span><input class="input" name="note" maxlength="1000" placeholder="For example: emailed about the missed essay"></label><div class="ai-card-actions"><button class="button button-primary" type="submit">Save follow-up</button><button class="button button-secondary" type="button" data-ew-cancel>Cancel</button></div></form>`;
      out.innerHTML = items.length ? `<div class="ew-toolbar"><span class="ui-meta">${items.length} ${items.length === 1 ? "student" : "students"} · ${items.filter((row) => row.lastFollowUp).length} followed up</span><div class="ew-tools"><label class="ew-sort"><span>Sort by</span><select class="input" data-ew-sort><option value="reasons"${sort === "reasons" ? " selected" : ""}>Most reasons</option><option value="name"${sort === "name" ? " selected" : ""}>Name</option><option value="pending"${sort === "pending" ? " selected" : ""}>Not followed up first</option></select></label><button class="button button-secondary" type="button" data-ew-csv>Download CSV</button></div></div>
        <ul class="ui-rows ew-list">${sorted.map((row) => `<li class="ui-row ew-row">${ui.ico("alert", row.reasons.some((reason) => reason.code === "financial_hold") || row.reasons.length > 2 ? "red" : "amber", "ui-icon-sm")}<div><strong>${esc(row.studentName)}</strong><span class="ui-meta">${esc(row.studentNumber)} · ${esc(row.programmeCode)}</span><div class="ai-chips">${row.reasons.map((reason) => `<span class="ew-chip ${reasonTone[reason.code] || "is-info"}" title="${esc(reason.text)}">${esc(reason.text)}</span>`).join("")}</div>${followed(row)}${openForm === row.programmeId ? form(row) : ""}</div><div class="ew-actions"><button class="button button-secondary" type="button" data-ew-open="${esc(row.programmeId)}">Open record</button>${openForm === row.programmeId ? "" : `<button class="button button-secondary" type="button" data-ew-follow="${esc(row.programmeId)}">Record follow-up</button>`}</div></li>`).join("")}</ul>`
        : ui.emptyState({ glyph: "check", text: "No students match the early-warning rules right now.", compact: true });
      out.querySelector("[data-ew-sort]")?.addEventListener("change", (event) => { sort = event.target.value; draw(); });
      out.querySelectorAll("[data-ew-open]").forEach((link) => link.addEventListener("click", () => openRecord(items.find((row) => row.programmeId === link.dataset.ewOpen))));
      out.querySelectorAll("[data-ew-follow]").forEach((link) => link.addEventListener("click", () => { openForm = link.dataset.ewFollow; draw(); out.querySelector("[data-ew-form] select")?.focus(); }));
      out.querySelector("[data-ew-cancel]")?.addEventListener("click", () => { openForm = null; draw(); });
      out.querySelector("[data-ew-form]")?.addEventListener("submit", (event) => { event.preventDefault(); const target = event.currentTarget, values = Object.fromEntries(new FormData(target));
        busy(target.querySelector("[type=submit]"), "Saving...", async () => {
          try {
            const saved = await call("POST", `/api/registry/early-warning/${encodeURIComponent(target.dataset.ewForm)}/follow-ups`, values);
            const row = items.find((item) => item.programmeId === target.dataset.ewForm);
            if (row) row.lastFollowUp = { outcome: saved.outcome, at: saved.at, note: values.note, by: "You" };
            openForm = null; draw();
          } catch (error) { target.insertAdjacentHTML("beforeend", errorBox(error.message)); }
        }); });
      out.querySelector("[data-ew-csv]")?.addEventListener("click", (event) => busy(event.currentTarget, "Preparing...", async () => {
        const response = await fetch("/api/registry/early-warning?format=csv", { headers: { Authorization: `Bearer ${token()}` } });
        if (!response.ok) { out.insertAdjacentHTML("afterbegin", errorBox("The list could not be exported.")); return; }
        const link = document.createElement("a"); link.href = URL.createObjectURL(await response.blob()); link.download = `early-warning-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 5000);
      }));
    };
    if (ewCache?.token === token()) { items = ewCache.items; draw(); } else ewCache = null;
    button.addEventListener("click", () => busy(button, "Checking records...", async () => {
      try { items = (await call("GET", "/api/registry/early-warning")).items; ewCache = { token: token(), items }; draw(); } catch (error) { out.innerHTML = errorBox(error.message); }
    }));
  }

  let scheduled = false;
  const scan = () => { scheduled = false; const app = document.querySelector("#app"); if (!app) return;
    earlyWarning(app);
    ui.aiEnabled().then((enabled) => { if (!enabled) return; feedback(app); support(app); guidance(app); explain(app); });
  };
  new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(scan); } }).observe(document.querySelector("#app"), { childList: true, subtree: true });
})();
