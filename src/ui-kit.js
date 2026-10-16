(function () {
  // Shared page anatomy for every non-student screen, matching the live Study / Office pages
  // (docs/SVU_UI_STANDARD.md). Markup helpers only: no data loading, routing or behaviour.
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const human = (value) => String(value ?? "").replaceAll("_", " ");
  const sentence = (value) => human(value).replace(/^\w/, (char) => char.toUpperCase());
  const date = (value) => value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  const svg = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  const icons = window.svuIcons || {
    calendar: svg("M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"),
    book: svg("M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z"),
    alert: svg("M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01"),
    chevron: svg("m9 18 6-6-6-6"),
    check: svg("M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3"),
    clock: svg("M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"),
    wallet: svg("M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"),
    file: svg("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M16 13H8M16 17H8M10 9H8"),
    user: svg("M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"),
    users: svg("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"),
    cap: svg("M22 10 12 5 2 10l10 5 10-5ZM6 12v5c3 3 9 3 12 0v-5"),
    inbox: svg("M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z"),
    grid: svg("M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"),
    shield: svg("M12 3 4 7v5c0 5 3.4 7.8 8 9 4.6-1.2 8-4 8-9V7ZM9 12l2 2 4-4"),
    lock: svg("M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4"),
    info: svg("M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"),
    list: svg("M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"),
    history: svg("M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"),
    chart: svg("M3 3v18h18M7 15l4-4 3 3 5-6"),
    settings: svg("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15.1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6V4.5a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1A1.7 1.7 0 0 0 21 11h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z"),
    truck: svg("M10 17h4V5H2v12h3M14 9h4l4 4v4h-2M7.5 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17.5 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"),
    box: svg("M21 8 12 3 3 8v8l9 5 9-5ZM3 8l9 5 9-5M12 13v8"),
    sun: svg("M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"),
    search: svg("m21 21-4.2-4.2m1.2-5.3a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"),
    plus: svg("M12 5v14M5 12h14"),
    // One set for controls that used text symbols or emoji before (docs/VISUAL_SYSTEM.md).
    arrowLeft: svg("M19 12H5M11 18l-6-6 6-6"),
    arrowRight: svg("M5 12h14M13 6l6 6-6 6"),
    refresh: svg("M20 11a8 8 0 0 0-14.7-4.4L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.4L20 16M20 20v-4h-4"),
    external: svg("M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"),
    x: svg("M6 6l12 12M18 6 6 18"),
    thumbUp: svg("M7 11v9H4v-9ZM7 11l4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7"),
    thumbDown: svg("M17 13V4h3v9ZM17 13l-4 8a2 2 0 0 1-2-2v-4H5.5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.7 4H17"),
    sparkle: svg("M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"),
    download: svg("M12 3v12M7 10l5 5 5-5M5 21h14"),
    send: svg("M4 12h14M13 6l6 6-6 6")
  };
  const glyph = (name) => icons[name] || window.svuShell?.glyphs?.[name] || icons.info;
  const ico = (name, tone = "", size = "") => `<span class="ui-icon ${size} ${tone ? `ui-icon-${tone}` : ""}">${glyph(name)}</span>`;
  const chevron = `<span class="ui-chevron">${icons.chevron}</span>`;
  const badge = (text, tone = "") => `<span class="ui-badge ${tone ? `ui-badge-${tone}` : ""}">${esc(text)}</span>`;

  // One vocabulary for workflow states: words, never raw codes, and a tone that always has a word beside it.
  const tones = {
    green: ["onboarded", "active", "confirmed", "approved", "completed", "resolved", "issued", "published", "accepted", "clean", "current", "returned_to_service", "available", "allocated", "paid", "matched", "enrolled", "verified", "ready", "on"],
    blue: ["open", "in_progress", "scheduled", "draft", "submitted", "under_review", "pending_review", "recommended", "uploaded", "assigned", "queued", "sent"],
    amber: ["requested", "pending", "waiting_student", "waiting_applicant", "waiting_staff", "returned", "pending_onboarding", "information_requested", "upload_requested", "overdue", "in_arrears", "escalated", "interrupted", "deferred", "held", "unmatched", "expiring"],
    red: ["blocked", "rejected", "revoked", "suspended", "denied", "failed", "infected", "dead_letter", "declined", "expired", "disposed", "lost"]
  };
  const toneFor = Object.fromEntries(Object.entries(tones).flatMap(([tone, list]) => list.map((value) => [value, tone])));
  const labels = { onboarded: "Active student", pending_onboarding: "Onboarding", waiting_student: "Waiting for student", waiting_applicant: "Waiting for applicant", waiting_staff: "Waiting for staff", in_progress: "In progress", dead_letter: "Not delivered", information_requested: "Information requested", upload_requested: "Upload requested", in_arrears: "In arrears" };
  const statusLabel = (value) => labels[String(value ?? "").toLowerCase()] || sentence(String(value ?? "").toLowerCase());
  const status = (value) => value == null || value === "" ? "" : badge(statusLabel(value), toneFor[String(value).toLowerCase()] || "");

  const head = (title, { desc = "", href = "", label = "View all", actions = "", level = 2, eyebrow = "" } = {}) => `<header class="ui-section-head"><div>${eyebrow ? `<p class="ui-eyebrow">${esc(eyebrow)}</p>` : ""}<h${level} class="ui-section-title">${esc(title)}</h${level}>${desc ? `<p class="ui-meta">${esc(desc)}</p>` : ""}</div>${href ? `<a class="ui-link" href="${esc(href)}">${esc(label)}</a>` : actions}</header>`;
  // A flat white page band, the student pages' primary surface.
  const panel = (title, body, opts = {}) => `<section class="ui-panel ${opts.cls || ""}" ${opts.attrs || ""}>${title ? head(title, opts) : ""}${body}</section>`;
  // Drawn illustrations for empty states and success moments (docs/VISUAL_SYSTEM.md); decorative, so empty alt text.
  const illustrations = ["calendar", "inbox", "courses", "search", "documents", "people", "success", "seal"];
  const illustration = (name, { cls = "", alt = "" } = {}) => illustrations.includes(name) ? `<img class="ui-illustration ${cls}" src="/src/assets/illustrations/${name}.svg" alt="${esc(alt)}" width="160" height="120" decoding="async">` : "";
  // Empty states show a matching illustration; the icon remains for anything without one.
  const artFor = { calendar: "calendar", clock: "calendar", inbox: "inbox", book: "courses", cap: "courses", search: "search", file: "documents", shield: "documents", user: "people", users: "people", check: "success" };
  const emptyState = ({ glyph: name = "info", title = "", text = "", act = "", compact = false, art = artFor[name] } = {}) => `<div class="ui-empty ${compact ? "ui-empty-compact" : ""} ${art ? "has-art" : ""}">${art ? illustration(art) : ico(name, "blue", "ui-icon-lg")}${title ? `<p class="ui-card-title">${esc(title)}</p>` : ""}${text ? `<p class="ui-meta">${esc(text)}</p>` : ""}${act}</div>`;
  // One date-and-time style everywhere: "12 Oct 2026, 07:35" in the reader's locale order.
  const dateTime = (value) => value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

  // In-app dialogs instead of the browser's confirm() and prompt(): same look as the rest of the app, keyboard and
  // screen-reader friendly (native <dialog>), and resolved as promises.
  function dialog({ title, text = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, field = null }) {
    return new Promise((resolve) => {
      const node = document.createElement("dialog");
      node.className = "ui-dialog";
      node.setAttribute("aria-labelledby", "ui-dialog-title");
      node.innerHTML = `<form method="dialog" class="ui-dialog-body"><h2 id="ui-dialog-title">${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ""}
        ${field ? `<label class="field"><span>${esc(field.label)}</span>${field.multiline ? `<textarea class="input" name="value" rows="3" maxlength="${field.maxLength || 500}" ${field.required ? "required" : ""} placeholder="${esc(field.placeholder || "")}"></textarea>` : `<input class="input" name="value" maxlength="${field.maxLength || 200}" ${field.required ? "required" : ""} placeholder="${esc(field.placeholder || "")}">`}</label>` : ""}
        <div class="ui-dialog-actions"><button class="button button-secondary" type="button" value="cancel" data-dialog-cancel>${esc(cancelLabel)}</button><button class="button ${danger ? "button-danger" : "button-primary"}" type="submit" value="ok">${esc(confirmLabel)}</button></div></form>`;
      document.body.append(node);
      const finish = (value) => { node.close(); node.remove(); resolve(value); };
      node.querySelector("[data-dialog-cancel]").addEventListener("click", () => finish(field ? null : false));
      node.addEventListener("cancel", (event) => { event.preventDefault(); finish(field ? null : false); });
      node.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); finish(field ? node.querySelector("[name=value]").value.trim() : true); });
      node.showModal();
      (node.querySelector("[name=value]") || node.querySelector("[type=submit]")).focus();
    });
  }
  const confirmAction = (options) => dialog(options);
  const ask = (options) => dialog({ ...options, field: { label: options.label || "Reason", multiline: true, ...(options.field || {}) } });
  const row = ({ href, glyph: name, tone = "", title, meta = "", lead = "", trail = "", cls = "", attrs = "" }) => `<${href ? `a href="${esc(href)}"` : "div"} class="ui-row ${cls}" ${attrs}>${lead || (name ? ico(name, tone, "ui-icon-sm") : "")}<div><strong>${esc(title)}</strong>${meta ? `<span class="ui-meta">${meta}</span>` : ""}</div>${trail}</${href ? "a" : "div"}>`;
  // Facts take [label, value] pairs; values are escaped unless passed as { html }.
  const facts = (pairs, cls = "") => `<dl class="ui-facts ${cls}">${pairs.filter(Boolean).map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value && typeof value === "object" ? value.html : esc(value)}</dd></div>`).join("")}</dl>`;
  const attention = ({ tone = "warning", glyph: name = "alert", eyebrow = "Your attention", title, text = "", act = "", attrs = "" }) => {
    const [cls, iconTone] = { blocked: ["is-blocked", "red"], warning: ["", "amber"], info: ["is-info", "blue"] }[tone];
    return `<div class="ui-attention ${cls}" ${attrs}>${ico(name, iconTone, "ui-icon-lg")}<div><p class="ui-eyebrow">${esc(eyebrow)}</p><h2 class="ui-card-title">${esc(title)}</h2>${text ? `<p class="ui-meta">${text}</p>` : ""}</div>${act}</div>`;
  };
  const alert = (tone, title, text = "") => `<div class="ui-alert ui-alert-${tone}" ${tone === "error" ? 'role="alert"' : 'role="status"'}>${glyph(tone === "success" ? "check" : tone === "info" ? "info" : "alert")}<div><strong>${esc(title)}</strong>${text ? `<span>${esc(text)}</span>` : ""}</div></div>`;
  const action = (href, text, primary = false) => `<a class="button ${primary ? "button-primary" : "button-secondary"}" href="${esc(href)}">${esc(text)}</a>`;
  const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"; };
  const today = () => new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  // Post-render polish shared by every staff screen. It only adds attributes, so module markup, text and
  // test hooks stay exactly as rendered.
  const emptyLine = /^(no|nothing|none)\b[^.]{0,80}\.?$/i;
  function enhance(root) {
    if (!root) return;
    // "No cashbooks." style lines read as compact empty states, with their text untouched.
    for (const node of root.querySelectorAll(".staff-body p, .staff-body li, .staff-body td[colspan]")) {
      if (!node.children.length && emptyLine.test(node.textContent.trim()) && !node.closest(".ui-empty, .ui-facts, .notice, .ui-alert")) node.classList.add("ui-empty-line");
    }
    // Status pills keep their exact text; a recognised state only adds its tone.
    for (const pill of root.querySelectorAll(".pill:not(.pill-blue):not(.pill-warning), .status-badge")) {
      const tone = toneFor[pill.textContent.trim().toLowerCase().replace(/\s+/g, "_")];
      if (tone) pill.classList.add(`pill-tone-${tone}`);
    }
    for (const table of root.querySelectorAll("table")) {
      const headings = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
      if (!headings.length) continue;
      table.classList.add("ui-stacked");
      for (const tr of table.querySelectorAll("tbody tr")) {
        let column = 0;
        for (const cell of tr.children) {
          if (!cell.hasAttribute("data-label") && headings[column]) cell.setAttribute("data-label", headings[column]);
          column += Number(cell.getAttribute("colspan") || 1);
        }
      }
    }
  }

  // Progress ring: done of total, with the numbers in words for assistive technology.
  function ring(done, total, label = "submitted") {
    const share = total ? Math.min(1, done / total) : 0, circumference = 2 * Math.PI * 22;
    return `<span class="ui-ring" role="img" aria-label="${esc(`${done} of ${total} ${label}`)}"><svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="22" class="ui-ring-track"/>${share > 0 ? `<circle cx="28" cy="28" r="22" class="ui-ring-value ${share >= 1 ? "is-complete" : ""}" stroke-dasharray="${(share * circumference).toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 28 28)"/>` : ""}</svg><span class="ui-ring-text">${done}<small>/${total}</small></span></span>`;
  }
  // Half-circle gauge with the allowable threshold marked; green within it, amber above.
  function gauge(score, threshold) {
    const point = (value) => { const angle = Math.PI * (1 - Math.min(100, Math.max(0, value)) / 100); return [50 + 40 * Math.cos(angle), 50 - 40 * Math.sin(angle)]; };
    const [x, y] = point(score), [tx, ty] = point(threshold), [ox, oy] = [50 + 46 * Math.cos(Math.PI * (1 - threshold / 100)), 50 - 46 * Math.sin(Math.PI * (1 - threshold / 100))];
    const above = score > threshold;
    return `<span class="ui-gauge ${above ? "is-above" : "is-within"}" role="img" aria-label="${esc(`AI similarity ${score}%, allowable ${threshold}%, ${above ? "above" : "within"} the threshold`)}"><svg viewBox="0 0 100 58" aria-hidden="true"><path d="M10 50 A40 40 0 0 1 90 50" class="ui-gauge-track"/><path d="M10 50 A40 40 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}" class="ui-gauge-value"/><line x1="${tx.toFixed(2)}" y1="${ty.toFixed(2)}" x2="${ox.toFixed(2)}" y2="${oy.toFixed(2)}" class="ui-gauge-tick"/></svg><span class="ui-gauge-text">${esc(Math.round(score * 100) / 100)}%</span></span>`;
  }
  const initials = (name) => String(name || "?").split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();

  // Whether Claude-backed assistance is enabled on this server; fetched once per page load.
  let aiStatus = null;
  // The full status ({ enabled, askSvuPersonal }), fetched once per page load.
  const aiDetails = () => aiStatus ||= fetch("/api/ai/status").then((response) => response.ok ? response.json() : { data: { enabled: false } }).then((body) => body.data || { enabled: false }).catch(() => ({ enabled: false }));
  const aiEnabled = () => aiDetails().then((status) => Boolean(status.enabled));
  const aiNote = "AI-generated suggestion. Check it before you use it.";

  // A notification's in-app route, or the fallback when it has none or it is not a plain hash route.
  const inAppLink = (link, fallback = "#messages") => typeof link === "string" && /^#[A-Za-z0-9_/?=&.%-]{1,200}$/.test(link) ? link : fallback;
  window.svuUI = { inAppLink,
    aiEnabled, aiDetails, aiNote, ring, gauge, initials, esc, human, sentence, date, dateTime, icons, glyph, ico, chevron, badge, status, statusLabel, toneFor, head, panel, emptyState, row, facts, attention, alert, action, greeting, today, enhance,
    illustration, confirm: confirmAction, ask };
})();
