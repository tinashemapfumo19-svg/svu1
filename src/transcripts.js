(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const kinds = {internal_transfer:"Internal transfer",external_transfer:"External transfer",exemption:"Exemption"};
  const gpa = (value) => value === null || value === undefined ? "-" : Number(value).toFixed(2);
  const date = (value) => value ? new Date(value).toISOString().slice(0,10) : "";
  const verifyUrl = (code) => `${location.origin}${location.pathname}#verify/${code}`;

  const banner = (issued,kind) => issued ? (issued.status === "issued" ? "" : `<p class="transcript-banner" data-transcript-banner>${issued.status === "revoked" ? "REVOKED" : "SUPERSEDED"} - not valid as a current record</p>`)
    : `<p class="transcript-banner" data-transcript-banner>PREVIEW - not an issued ${kind}</p>`;
  // Wording comes from the approved template the document was issued under (or, for a preview, the one in force).
  const signature = (t) => `<div class="transcript-signature" data-template-signatory>${t.signatoryName ? `<strong>${esc(t.signatoryName)}</strong><br>` : ""}${esc(t.signatoryTitle)}</div>`;
  const footer = (issued,t) => `${signature(t)}<footer class="transcript-foot"><p>${esc(t.footerText)}</p>${issued ? `<p>Verify this document at ${esc(verifyUrl(issued.verificationCode))}</p><p class="result-checksum">${esc(issued.contentHash)}</p>` : ""}</footer>`;
  const meta = (issued) => issued ? `<dl class="transcript-meta"><dt>Reference</dt><dd data-transcript-reference>${esc(issued.referenceNumber || "-")}</dd><dt>Issued</dt><dd>${esc(date(issued.issuedAt))}</dd><dt>Verification code</dt><dd data-transcript-code>${esc(issued.verificationCode)}</dd></dl>` : "";
  const label = (row) => row.kind === "certificate" ? "Award certificate" : "Transcript";

  function certificateView(content,issued,t) {
    return `<article class="transcript-document certificate-document" data-transcript-document="${esc(issued?.id || "certificate-preview")}">${banner(issued,"certificate")}
      <p class="eyebrow">${esc(t.institutionName)}</p><p data-template-preamble>${esc(t.preamble)}</p><h2 data-certificate-holder>${esc(content.student.legalName)}</h2>
      <p>student number ${esc(content.student.studentNumber)}, ${esc(t.conferralText.replaceAll("{{programme}}",content.programme.name))}</p>
      <h3 data-certificate-award>${esc(content.award.title)}</h3>${content.award.classification ? `<p>with ${esc(content.award.classification)}</p>` : ""}
      <p>Conferred ${esc(content.award.conferredOn)}</p>
      ${meta(issued)}${footer(issued,t)}</article>`;
  }

  // The printable document. `issued` is absent for an unissued preview, which is watermarked as not official.
  function documentView(content,issued,template) {
    const t = (issued?.template || template).content;
    if (content.kind === "certificate") return certificateView(content,issued,t);
    const status = banner(issued,"transcript");
    return `<article class="transcript-document" data-transcript-document="${esc(issued?.id || "preview")}">
      ${status}
      <header class="transcript-head"><div><p class="eyebrow">${esc(t.institutionName)}</p><h2>${esc(t.title)} (${content.award ? "final" : "progressive"})</h2></div>
        ${meta(issued)}</header>
      <dl class="transcript-meta transcript-holder"><dt>Student</dt><dd>${esc(content.student.legalName)}</dd><dt>Student number</dt><dd>${esc(content.student.studentNumber)}</dd>
        <dt>Programme</dt><dd>${esc(content.programme.name)} (${esc(content.programme.code)})</dd><dt>Curriculum</dt><dd>${esc(content.programme.versionLabel)} - ${esc(content.programme.intakeLabel)}</dd>
        <dt>Programme status</dt><dd>${esc(content.programme.status)}</dd></dl>
      ${content.terms.map((term) => `<section class="transcript-term" data-transcript-term="${esc(term.periodId)}"><h3>${esc(term.name)} - year ${term.yearOfStudy}, ${esc(term.term)}</h3>
        <div class="result-table-wrap"><table class="result-table"><thead><tr><th>Course</th><th>Title</th><th>Credits</th><th>Mark</th><th>Grade</th></tr></thead><tbody>
        ${term.results.map((row) => `<tr><td>${esc(row.code)}</td><td>${esc(row.title)}</td><td>${row.credits}</td><td>${row.mark}${row.amended ? " *" : ""}</td><td>${esc(row.grade)}</td></tr>`).join("")}</tbody></table></div>
        <p>Term GPA ${gpa(term.gpa)} - ${term.creditsPassed} of ${term.creditsAttempted} credits passed</p></section>`).join("")}
      ${content.recognitions.length ? `<section class="transcript-term"><h3>Recognized credit</h3><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Course</th><th>Title</th><th>Credits</th><th>Basis</th></tr></thead><tbody>
        ${content.recognitions.map((row) => `<tr><td>${esc(row.code)}</td><td>${esc(row.title)}</td><td>${row.credits}</td><td>${esc(kinds[row.kind] || row.kind)}</td></tr>`).join("")}</tbody></table></div><p>Recognized credit is not included in any GPA.</p></section>` : ""}
      ${content.award ? `<section class="transcript-award" data-transcript-award><h3>Award</h3><p><strong>${esc(content.award.title)}</strong>${content.award.classification ? ` - ${esc(content.award.classification)}` : ""}, conferred ${esc(content.award.conferredOn)}</p></section>` : ""}
      <section class="transcript-summary" data-transcript-summary><h3>Summary</h3><p>Cumulative GPA ${gpa(content.summary.cumulativeGpa)}${content.summary.classification ? ` (${esc(content.summary.classification)})` : ""} - ${content.summary.creditsPassed} credits passed, ${content.summary.creditsRecognised} credits recognized</p>
        ${content.terms.some((term) => term.results.some((row) => row.amended)) ? "<p>* Result amended after publication under the approved amendment procedure.</p>" : ""}<p class="muted" data-template-notes>${esc(t.notes)}</p></section>
      ${footer(issued,t)}
    </article>`;
  }

  function printButton(key) {
    return `<button class="button button-secondary" type="button" data-transcript-print="${esc(key)}">Print or save as PDF</button>`;
  }
  // Printing isolates one document; the print stylesheet hides everything else.
  function bindPrint(root) {
    root.querySelectorAll("[data-transcript-print]").forEach((button) => button.addEventListener("click",() => {
      const target = root.querySelector(`[data-transcript-document="${button.dataset.transcriptPrint}"]`);
      if (!target) return;
      document.body.classList.add("printing-transcript"); target.classList.add("print-target");
      const done = () => {document.body.classList.remove("printing-transcript"); target.classList.remove("print-target"); window.removeEventListener("afterprint",done);};
      window.addEventListener("afterprint",done); window.print();
    }));
  }

  function staffRender(state) {
    const data = state.transcripts;
    if (!data) return "";
    const open = state.transcriptOpen;
    const current = data.transcripts.find((row) => row.status === "issued" && row.kind === "progressive");
    const certificate = data.transcripts.find((row) => row.status === "issued" && row.kind === "certificate");
    const empty = !data.current.content.terms.length && !data.current.content.recognitions.length;
    return `<section class="registry-transcripts" data-registry-transcripts><header class="section-header"><h3>Transcripts and certificates</h3>${empty ? "" : `<button class="button button-secondary" type="button" data-transcript-open="preview">Preview current record</button>`}</header>
      <p>${empty ? "No published results or recognized credit yet." : `Current record: ${data.current.content.terms.length} term(s), cumulative GPA ${gpa(data.current.content.summary.cumulativeGpa)}`}${current?.outdated ? ` - <strong data-transcript-outdated>the issued transcript no longer matches the record</strong>` : ""}</p>
      ${data.capabilities.issue && !empty ? `<form class="form form-grid" data-transcript-issue><input type="hidden" name="expectedHash" value="${esc(data.current.contentHash)}">
        <label class="field"><span>Issue reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">${current ? "Issue updated transcript" : "Issue transcript"}</button></div></form>` : ""}
      ${data.current.certificate ? `<p data-certificate-ready>The award is conferred.${certificate?.outdated ? " <strong>The issued certificate no longer matches the award.</strong>" : ""} <button class="button button-secondary" type="button" data-transcript-open="certificate-preview">Preview certificate</button></p>
        ${data.capabilities.issue ? `<form class="form form-grid" data-certificate-issue><input type="hidden" name="expectedHash" value="${esc(data.current.certificate.contentHash)}">
          <label class="field"><span>Certificate reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">${certificate ? "Reissue certificate" : "Issue certificate"}</button></div></form>` : ""}` : ""}
      ${data.transcripts.map((row) => `<section class="transcript-issue" data-transcript="${esc(row.id)}"><header class="section-header"><h4>${label(row)} ${esc(row.referenceNumber || row.verificationCode)} - issued ${esc(date(row.issuedAt))}</h4><strong>${esc(row.status)}</strong></header>
        <p>${esc(row.reason)}${row.revokeReason ? ` - revoked: ${esc(row.revokeReason)}` : ""}</p>
        <div class="button-row"><button class="button button-secondary" type="button" data-transcript-open="${esc(row.id)}">View</button></div>
        ${data.capabilities.issue && row.status === "issued" ? `<details><summary>Revoke ${label(row).toLowerCase()}</summary><form class="form form-grid" data-transcript-revoke="${esc(row.id)}"><label class="field"><span>Revocation reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Revoke document</button></div></form></details>` : ""}
      </section>`).join("")}
      ${open ? `<div class="transcript-viewer">${printButton(open)}${open === "preview" ? documentView(data.current.content,null,data.templates.progressive) : open === "certificate-preview" && data.current.certificate ? documentView(data.current.certificate.content,null,data.templates.certificate) : (() => {const row = data.transcripts.find((entry) => entry.id === open); return row ? documentView(row.content,row) : "";})()}</div>` : ""}
    </section>`;
  }
  function staffBind(root,state,{api,act}) {
    const data = state.transcripts;
    if (!data) return;
    const base = `/api/registry/programmes/${state.detail.id}/transcripts`;
    const reload = async () => {state.transcripts = await api("GET",base);};
    root.querySelectorAll("[data-transcript-open]").forEach((button) => button.addEventListener("click",() => {state.transcriptOpen = state.transcriptOpen === button.dataset.transcriptOpen ? null : button.dataset.transcriptOpen; act(async () => {});}));
    root.querySelector("[data-transcript-issue]")?.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.target));
      act(async () => {const issued = await api("POST",base,values); await reload(); state.transcriptOpen = issued.id; state.notice = `Transcript issued with verification code ${issued.verificationCode}.`;});
    });
    root.querySelectorAll("[data-transcript-revoke]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      act(async () => {await api("POST",`${base}/${form.dataset.transcriptRevoke}/revoke`,values); await reload(); state.notice = "Document revoked.";});
    }));
    root.querySelector("[data-certificate-issue]")?.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.target));
      act(async () => {const issued = await api("POST",base,{...values,kind:"certificate"}); await reload(); state.transcriptOpen = issued.id; state.notice = "Certificate issued with verification code " + issued.verificationCode + ".";});
    });
    bindPrint(root);
  }

  // Students see every transcript issued for the programme and can print the current one.
  function studentView(list,openId) {
    if (!list?.transcripts.length) return "";
    const open = list.transcripts.find((row) => row.id === openId);
    return `<section class="student-transcripts" data-student-transcripts><h2>Transcripts and certificates</h2>
      ${list.transcripts.map((row) => `<p data-transcript="${esc(row.id)}">${label(row)} <strong>${esc(row.verificationCode)}</strong> - issued ${esc(date(row.issuedAt))} - ${esc(row.status)}${row.outdated ? " (your record has changed since; ask the registry for an updated copy)" : ""}
        <button class="button button-secondary" type="button" data-student-transcript="${esc(row.id)}">${open?.id === row.id ? "Hide" : "View"}</button></p>`).join("")}
      ${open ? `<div class="transcript-viewer">${printButton(open.id)}${documentView(open.content,open)}</div>` : ""}</section>`;
  }

  // A scanned student ID card: shows whether the holder is a current student right now.
  async function renderCardCheck(app,value) {
    const ui = window.svuUI;
    let card = null,error = "",expired = false;
    try {
      const response = await fetch(`/api/verify/card/${encodeURIComponent(value)}`);
      const body = await response.json();
      if (response.ok) card = body.data; else { error = body.error?.message || "Verification failed."; expired = response.status === 410; }
    } catch {error = "Verification service is unavailable.";}
    const [glyph,tone,title] = card ? (card.current ? ["check","green","Current student"] : ["alert","red","Not a current student"]) : expired ? ["clock","amber","Code expired"] : ["alert","red","Not recognised"];
    app.innerHTML = `<section class="verify-page registry-workspace"><header class="section-header staff-page-head"><div><p class="eyebrow">Document verification</p><h1 class="page-title">Student ID check</h1><p class="ui-meta ui-page-description">Result of scanning a South Valley University student card.</p></div></header>
      <div class="staff-body"><article class="verify-result ui-panel" data-verify-card="${card ? (card.current ? "current" : "not-current") : expired ? "expired" : "invalid"}"><div class="staff-record-hero"><div class="verify-verdict">${ui.ico(glyph,tone,"ui-icon-lg")}<div><h2>${esc(title)}</h2><p class="ui-meta">${card ? `Checked ${esc(window.svuUI.dateTime(card.checkedAt))}` : esc(error)}</p></div></div></div>
      ${card ? `<dl class="transcript-meta"><dt>Name</dt><dd>${esc(card.legalName)}</dd><dt>Student number</dt><dd>${esc(card.studentNumber)}</dd><dt>Programme</dt><dd>${esc(card.programme.name)} (${esc(card.programme.code)})</dd><dt>Intake</dt><dd>${esc(card.intakeLabel)}</dd></dl>
        <p class="ui-meta">Compare the name and number with the card on the student's screen. The code on a genuine card changes every few minutes.</p>` : ""}</article></div></section>`;
  }

  async function renderVerify(app,code) {
    const value = code ? decodeURIComponent(code) : "";
    if (value.startsWith("card-")) return renderCardCheck(app,value);
    let result = null,error = "";
    if (value) {
      try {
        const response = await fetch(`/api/verify/transcripts/${encodeURIComponent(value)}`);
        const body = await response.json();
        if (response.ok) result = body.data; else error = body.error?.message || "Verification failed.";
      } catch {error = "Verification service is unavailable.";}
    }
    const states = {issued:"Valid - this is the current issued document",superseded:"Authentic but superseded - a newer document has been issued",revoked:"Revoked - this document is not valid"};
    const ui = window.svuUI;
    const tone = {issued:["check","green","Valid"],superseded:["history","amber","Superseded"],revoked:["alert","red","Revoked"]}[result?.status] || ["info","blue",""];
    app.innerHTML = `<section class="verify-page registry-workspace"><header class="section-header staff-page-head"><div><p class="eyebrow">Document verification</p><h1 class="page-title">Verify a transcript, certificate or letter</h1><p class="ui-meta ui-page-description">Enter the verification code printed on an official South Valley University document.</p></div></header>
      <div class="staff-body">
      <section class="ui-panel"><form class="staff-filter" data-verify-form><label class="field field-wide"><span>Verification code</span><input class="input" name="code" value="${esc(value)}" placeholder="XXXX-XXXX-XXXX-XXXX" required></label><div><button class="button button-primary" type="submit">Verify</button></div></form></section>
      ${error ? `<div class="notice notice-error" role="status">${esc(error)}</div>` : ""}
      ${!value && !error ? ui.emptyState({ glyph: "shield", title: "Check an official document", text: "The result shows whether the document is current, superseded or revoked, with the details it should contain." }) : ""}
      ${result ? `<article class="verify-result ui-panel" data-verify-result="${esc(result.status)}"><div class="staff-record-hero"><div class="verify-verdict">${ui.illustration("seal", { cls: "verify-seal", alt: "South Valley University seal" })}${ui.ico(tone[0], tone[1], "ui-icon-lg")}<div><h2>${esc(states[result.status])}</h2><p class="ui-meta" data-verify-kind>${result.kind === "letter" ? esc(result.title) : result.kind === "certificate" ? "Award certificate" : "Academic transcript"}</p></div></div>${ui.badge(tone[2], tone[1])}</div>
        <dl class="transcript-meta"><dt>Student</dt><dd>${esc(result.student.legalName)} (${esc(result.student.studentNumber)})</dd><dt>Programme</dt><dd>${esc(result.programme.name)} (${esc(result.programme.code)})</dd>
          ${result.referenceNumber ? `<dt>Reference</dt><dd data-verify-reference>${esc(result.referenceNumber)}</dd>` : ""}<dt>Issued</dt><dd>${esc(date(result.issuedAt))}</dd>${result.supersededAt ? `<dt>Superseded</dt><dd>${esc(date(result.supersededAt))}</dd>` : ""}${result.revokedAt ? `<dt>Revoked</dt><dd>${esc(date(result.revokedAt))}</dd>` : ""}
          ${result.letter ? `<dt>Record as of</dt><dd data-verify-asof>${esc(result.letter.asOf)}</dd><dt>Intake</dt><dd>${esc(result.letter.intake)}</dd>${result.letter.period ? `<dt>Semester</dt><dd>${esc(result.letter.period)}</dd>` : ""}${result.letter.courses.length ? `<dt>Courses</dt><dd>${result.letter.courses.map((row) => `${esc(row.code)} ${esc(row.title)}`).join("<br>")}</dd>` : ""}` : ""}${result.award ? `<dt>Award</dt><dd data-verify-award>${esc(result.award.title)}${result.award.classification ? ` (${esc(result.award.classification)})` : ""}, conferred ${esc(result.award.conferredOn)}</dd>` : ""}
          ${result.summary ? `<dt>Cumulative GPA</dt><dd>${gpa(result.summary.cumulativeGpa)}</dd><dt>Credits</dt><dd>${result.summary.creditsPassed} passed, ${result.summary.creditsRecognised} recognized</dd>` : ""}</dl>
        <p class="ui-meta">Compare these details and the fingerprint below with the document you were given.</p><p class="result-checksum">${esc(result.contentHash)}</p></article>` : ""}
    </div></section>`;
    app.querySelector("[data-verify-form]").addEventListener("submit",(event) => {
      event.preventDefault();
      location.hash = `#verify/${encodeURIComponent(new FormData(event.target).get("code").trim())}`;
    });
  }

  window.transcriptsUI = {staffRender,staffBind,studentView,bindPrint,renderVerify};
})();
