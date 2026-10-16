(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const stateLabels = {mark:"Mark",absent:"Absent",deferred:"Deferred",exempt:"Exempt"};
  const moderationLabels = {none:"No moderation",internal:"Internal moderation",internal_external:"Internal and external moderation"};
  function moderation(data,row) {
    const stages = data.plan.moderation === 'internal_external' ? ['internal','external'] : data.plan.moderation === 'internal' ? ['internal'] : [];
    return stages.map((stage) => {
      const review = row.moderations.find((entry) => entry.stage === stage);
      const eligible = row.canModerate && data.capabilities[stage === 'internal' ? 'moderate' : 'external']
        && !row.moderations.some((entry) => entry.reviewedBy === data.accountId || entry.outcome === 'changes_requested')
        && (stage !== 'external' || row.moderations.some((entry) => entry.stage === 'internal' && entry.outcome === 'signed'));
      return `<div data-moderation-stage="${stage}"><p>${stage === 'internal' ? 'Internal moderation' : 'External examiner'}: ${review ? esc(review.outcome.replaceAll('_',' ')) : 'Awaiting sign-off'}</p>
        ${review ? `<p>${esc(review.evidenceRef)} - ${esc(review.reason)}</p>` : eligible ? `<form class="form form-grid" data-moderation="${row.id}" data-stage="${stage}">
          <label class="field"><span>Moderation outcome</span><select class="input" name="outcome"><option value="signed">Sign off</option><option value="changes_requested">Request changes</option></select></label>
          <label class="field"><span>Evidence reference</span><input class="input" name="evidenceRef" maxlength="200" required></label>
          <label class="field"><span>Moderation reason</span><input class="input" name="reason" maxlength="2000" required></label>
          <div><button class="button button-primary" type="submit">Record sign-off</button></div></form>` : ''}</div>`;
    }).join('');
  }
  function deferred(data) {
    return (data.deferredSittings || []).map((sitting) => {
      const component = data.plan.components.find((row) => row.code === sitting.componentCode);
      const live = sitting.completions.find((row) => ['submitted','approved'].includes(row.status));
      return `<details data-deferred-sitting="${esc(sitting.id)}"><summary>${esc(sitting.paper)} - ${esc(window.svuUI.dateTime(sitting.startsAt))} - ${esc(sitting.status)}</summary>
        ${!sitting.ready && !live ? `<p>${esc(sitting.blockedReason)}</p>` : ''}
        ${sitting.completions.map((row) => `<section data-deferred-completion="${row.id}"><h4>Completion ${row.id}: ${esc(row.status)}</h4><p>${esc(row.evidenceRef)} - ${esc(row.reason)}</p>
          <ul>${row.entries.map((entry) => `<li>${esc(sitting.candidates.find((candidate) => candidate.registrationId === entry.registrationId)?.studentNumber)}: ${entry.state === 'mark' ? entry.mark : `Absent - ${esc(entry.reason)}`}</li>`).join('')}</ul>
          ${row.reviewReason ? `<p>${esc(row.reviewReason)}</p>` : ''}
          ${data.capabilities.review && row.status === 'submitted' && row.submittedBy !== data.accountId ? `<form class="form form-grid" data-deferred-review="${row.id}">
            <label class="field"><span>Completion decision</span><select class="input" name="outcome"><option value="approved">Approve</option><option value="returned">Return for changes</option></select></label>
            <label class="field"><span>Review reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Review completion</button></div></form>` : ''}</section>`).join('')}
        ${sitting.ready && !live && data.capabilities.enterMarks ? `<form class="form" data-deferred-record="${esc(sitting.id)}">
          <div class="result-table-wrap"><table class="result-table assessment-grid"><thead><tr><th>Candidate</th><th>Outcome</th><th>Mark (/${component.maxMark})</th><th>Absence reason</th></tr></thead><tbody>
          ${sitting.candidates.map((row) => `<tr><td>${esc(row.studentNumber)}<input type="hidden" name="revision:${esc(row.registrationId)}" value="${row.markRevision}"></td>
            <td><select class="input" name="state:${esc(row.registrationId)}" aria-label="${esc(row.studentNumber)} completion state"><option value="mark">Mark</option><option value="absent">Absent</option></select></td>
            <td><input class="input" type="number" name="mark:${esc(row.registrationId)}" aria-label="${esc(row.studentNumber)} completion mark" min="0" max="${component.maxMark}" step="1"></td>
            <td><input class="input" name="reason:${esc(row.registrationId)}" aria-label="${esc(row.studentNumber)} absence reason" maxlength="500"></td></tr>`).join('')}</tbody></table></div>
          <label class="field"><span>Evidence reference</span><input class="input" name="evidenceRef" maxlength="200" required></label>
          <label class="field"><span>Completion reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Submit deferred completion</button></div></form>` : ''}</details>`;
    }).join('');
  }
  function grid(data) {
    const plan = data.plan,locked = Boolean(data.live),editable = data.capabilities.enterMarks && !locked;
    return `<form class="form" data-assessment-marks><div class="result-table-wrap"><table class="result-table assessment-grid"><thead><tr><th>Student</th>${plan.components.map((component) => `<th>${esc(component.name)} (${component.weight}%, /${component.maxMark})</th>`).join("")}<th>Final</th></tr></thead><tbody>
      ${data.students.map((student) => `<tr data-assessment-student="${esc(student.studentNumber)}"><td>${esc(student.studentNumber)}<br>${esc(student.legalName)}</td>${plan.components.map((component) => {
        const entry = student.entries[component.code],key = `${student.registrationId}|${component.code}`;
        return `<td><input type="hidden" name="revision:${esc(key)}" value="${entry?.revision ?? 0}">
          <select class="input" name="state:${esc(key)}" aria-label="${esc(student.studentNumber)} ${esc(component.code)} state" ${editable ? "" : "disabled"}><option value="">-</option>${Object.entries(stateLabels).map(([value,label]) => `<option value="${value}" ${entry?.state === value ? "selected" : ""}>${label}</option>`).join("")}</select>
          <input class="input" name="mark:${esc(key)}" type="number" min="0" max="${component.maxMark}" step="1" value="${entry?.state === "mark" ? entry.mark : ""}" aria-label="${esc(student.studentNumber)} ${esc(component.code)} mark" ${editable ? "" : "disabled"}>
          <input class="input" name="reason:${esc(key)}" maxlength="500" placeholder="Reason if not marked" value="${esc(entry?.reason)}" aria-label="${esc(student.studentNumber)} ${esc(component.code)} reason" ${editable ? "" : "disabled"}></td>`;
      }).join("")}<td data-final>${student.final.state === "final" ? student.final.mark : esc(student.final.state)}</td></tr>`).join("")}</tbody></table></div>
      ${editable ? `<div><button class="button button-primary" type="submit">Save marks</button></div>` : ""}</form>`;
  }
  // Minimal RFC 4180 parsing: quoted cells may contain commas, doubled quotes, and line breaks.
  function parseCsv(textValue) {
    const rows = [];let row = [],cell = "",quoted = false;
    for (let i = 0;i < textValue.length;i++) {
      const char = textValue[i];
      if (quoted) {if (char === '"' && textValue[i + 1] === '"') {cell += '"'; i++;} else if (char === '"') quoted = false; else cell += char;}
      else if (char === '"') quoted = true;
      else if (char === ",") {row.push(cell); cell = "";}
      else if (char === "\n" || char === "\r") {if (char === "\r" && textValue[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = "";}
      else cell += char;
    }
    if (cell || row.length) {row.push(cell); rows.push(row);}
    return rows.filter((cells) => cells.some((value) => value.trim()));
  }
  const csvCell = (value) => /[",\r\n]/.test(String(value ?? "")) ? `"${String(value).replace(/"/g,'""')}"` : String(value ?? "");
  function upload(data,preview) {
    const report = preview && preview.planId === data.plan.id ? preview : null;
    return `<details data-marks-upload ${report ? "open" : ""}><summary>Upload marks file</summary>
      <p>CSV columns: student_number, component, value, reason. Value is a whole mark or ABSENT, DEFERRED, or EXEMPT (with a reason). Rows you leave out keep their current marks.</p>
      <button class="button button-secondary" type="button" data-marks-template>Download mark template</button>
      <form class="form form-grid" data-marks-import><label class="field"><span>Mark file</span><input class="input" type="file" name="file" accept=".csv,text/csv" required></label>
        <label class="field"><span>File reference</span><input class="input" name="sourceRef" maxlength="200" placeholder="Defaults to the file name"></label>
        <div><button class="button button-secondary" type="submit">Preview upload</button></div></form>
      ${report ? `<section class="assessment-import" data-import-report><p data-import-summary>${esc(report.sourceRef)}: ${report.summary.rows} row(s) - ${report.summary.new} new, ${report.summary.changed} changed, ${report.summary.unchanged} unchanged, ${report.summary.rejected} rejected</p>
        ${report.rejected.length ? `<div class="result-table-wrap"><table class="result-table"><thead><tr><th>Row</th><th>Student</th><th>Component</th><th>Problem</th></tr></thead><tbody>${report.rejected.map((row) => `<tr data-import-rejected="${row.row}"><td>${row.row}</td><td>${esc(row.studentNumber)}</td><td>${esc(row.componentCode)}</td><td>${esc(row.problem)}</td></tr>`).join("")}</tbody></table></div>
          <p>Correct the file and preview it again. Nothing has been saved.</p>`
          : `<button class="button button-primary" type="button" data-marks-apply>Apply ${report.summary.new + report.summary.changed} change(s)</button>`}</section>` : ""}
    </details>`;
  }
  function render(state) {
    const data = state.assessment;
    if (!data) return "";
    const can = data.capabilities,draft = data.plans.find((row) => row.status === "draft");
    return `<section class="assessment-panel" data-assessment="${esc(data.offering.periodId)}:${esc(data.offering.courseId)}"><header class="section-header"><h2>${esc(data.offering.code)} assessment - ${esc(data.offering.periodName)}</h2><button class="button button-secondary" type="button" data-assessment-close>Close</button></header>
      <details data-exam-orders><summary>Exam orders (${data.examOrders.length})</summary>
        ${data.examOrders.map((row) => `<div data-offering-order="${esc(row.id)}"><p><strong>${esc(row.paper)}</strong> - ${row.durationMinutes} minutes - ${esc(row.status)}${row.sittingId ? ' - sitting scheduled' : ''}</p>
          <p>Paper reference: ${esc(row.paperReference)}. Allowed materials: ${esc(row.materialsAllowed)}</p>${row.requirements ? `<p>${esc(row.requirements)}</p>` : ''}${row.reviewReason ? `<p>${esc(row.reviewReason)}</p>` : ''}${can.managePlan && row.status === 'approved' ? `<button class="button button-secondary" type="button" data-exam-papers-open="${esc(row.id)}">Paper custody</button>` : ''}</div>`).join('')}
        ${can.managePlan && data.offering.periodStatus === 'open' ? `<form class="form form-grid" data-exam-order-submit>
          <label class="field"><span>Paper</span><input class="input" name="paper" maxlength="60" value="Paper 1" required></label>
          <label class="field"><span>Duration (minutes)</span><input class="input" type="number" name="durationMinutes" min="15" max="480" step="15" value="120" required></label>
          <label class="field"><span>Paper reference</span><input class="input" name="paperReference" maxlength="200" required></label>
          <label class="field"><span>Allowed materials</span><input class="input" name="materialsAllowed" maxlength="500" required></label>
          <label class="field"><span>Special requirements</span><textarea class="input" name="requirements" maxlength="1000" rows="2"></textarea></label>
          <label class="field"><span>Order reason</span><input class="input" name="reason" maxlength="2000" required></label>
          <div><button class="button button-primary" type="submit">Submit exam order</button></div></form>` : ''}</details>
      ${data.plan ? `<p>Plan v${data.plan.version}: ${data.plan.components.map((row) => `${esc(row.name)} ${row.weight}%`).join(", ")} - ${moderationLabels[data.plan.moderation]}</p>` : "<p>No approved assessment plan yet.</p>"}
      ${draft ? `<section class="assessment-plan" data-assessment-plan="${esc(draft.id)}"><p>Draft v${draft.version} awaiting approval: ${draft.components.map((row) => `${esc(row.name)} ${row.weight}% (/${row.maxMark})`).join(", ")} - ${moderationLabels[draft.moderation]} - ${esc(draft.reason)}</p>
        ${can.approvePlan && draft.createdBy !== data.accountId ? `<form class="form form-grid" data-plan-approve="${esc(draft.id)}"><label class="field"><span>Plan approval reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Approve plan</button></div></form>` : ""}</section>` : ""}
      ${can.managePlan && !draft ? `<details><summary>${data.plan ? "Propose a new plan version" : "Draft assessment plan"}</summary><form class="form form-grid" data-plan-draft>
        <label class="field"><span>Components (one per line: CODE, name, weight, maximum mark)</span><textarea class="input" name="components" rows="4" required>${data.plan ? data.plan.components.map((row) => `${row.code}, ${row.name}, ${row.weight}, ${row.maxMark}`).join("\n") : "CW, Coursework, 40, 100\nEXAM, Final examination, 60, 100"}</textarea></label>
        <label class="field"><span>Required moderation</span><select class="input" name="moderation">${Object.entries(moderationLabels).map(([value,label]) => `<option value="${value}" ${(data.plan?.moderation || 'none') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label class="field"><span>Plan reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Draft plan</button></div></form></details>` : ""}
      ${data.plan ? `${grid(data)}${can.enterMarks && !data.live ? upload(data,state.markImport) : ""}<p data-assessment-missing>${data.missing.length ? `${data.missing.length} mark(s) missing` : "All marks entered"}${data.live ? ` - submission ${esc(data.live.status)}` : ""}</p>
        ${can.submit && !data.live && !data.missing.length && data.students.length ? `<form class="form form-grid" data-assessment-submit><label class="field"><span>Submission note</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Submit marks for review</button></div></form>` : ""}
        ${data.submissions.map((row) => `<section class="assessment-submission" data-assessment-submission="${row.id}"><header class="section-header"><h4>Submission ${row.id}</h4><strong>${esc(row.status)}</strong></header><p>${esc(row.submitReason)}</p>${row.reviewReason ? `<p>${esc(row.reviewReason)}</p>` : ""}
          ${moderation(data,row)}
          ${can.review && row.status === "submitted" && row.submittedBy !== data.accountId ? `<form class="form form-grid" data-submission-review="${row.id}"><label class="field"><span>Marks decision</span><select class="input" name="outcome">${row.moderationComplete ? '<option value="approved">Approve</option>' : ''}<option value="returned">Return for changes</option></select></label>
            <label class="field"><span>Marks review reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Review marks</button></div></form>` : ""}</section>`).join("")}` : ""}
      ${data.plan ? deferred(data) : ''}
    </section>`;
  }
  async function load(state,api,key) {
    const [periodId,courseId] = key.split(":");
    state.assessment = await api("GET",`/api/assessment/offerings/${periodId}/${courseId}`); state.markImport = null;
  }
  function bind(root,state,{api,act}) {
    root.querySelectorAll("[data-assessment-load]").forEach((button) => button.addEventListener("click",() => act(() => load(state,api,button.dataset.assessmentLoad))));
    root.querySelector("[data-assessment-close]")?.addEventListener("click",() => {state.assessment = null; state.markImport = null; act(async () => {});});
    const data = state.assessment;
    if (!data) return;
    const base = `/api/assessment/offerings/${data.offering.periodId}/${data.offering.courseId}`;
    const submit = (selector,work) => root.querySelectorAll(selector).forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      act(async () => {state.assessment = await work(form,values); state.notice = form.dataset.notice || state.notice;});
    }));
    submit('[data-deferred-record]',async (form,values) => {
      const sitting = data.deferredSittings.find((row) => row.id === form.dataset.deferredRecord);
      const entries = sitting.candidates.map((row) => {
        const state = values[`state:${row.registrationId}`],entry = {registrationId:row.registrationId,state,revision:Number(values[`revision:${row.registrationId}`])};
        if (state === 'mark') {if (values[`mark:${row.registrationId}`] === '') throw new Error('Enter a mark for every candidate.'); entry.mark = Number(values[`mark:${row.registrationId}`]);}
        else entry.reason = values[`reason:${row.registrationId}`];
        return entry;
      });
      const result = await api('POST',`/api/assessment/deferred-sittings/${sitting.id}/completions`,{entries,evidenceRef:values.evidenceRef,reason:values.reason}); state.notice = 'Deferred completion submitted for review.'; return result;
    });
    submit('[data-deferred-review]',async (form,values) => {const result = await api('POST',`/api/assessment/deferred-completions/${form.dataset.deferredReview}/review`,values); state.notice = `Deferred completion ${values.outcome}.`; return result;});
    submit("[data-plan-draft]",async (form,values) => {
      const components = values.components.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {const [code,name,weight,maxMark] = line.split(",").map((cell) => cell.trim()); return {code,name,weight:Number(weight),maxMark:Number(maxMark)};});
      const result = await api("POST",`${base}/plans`,{components,reason:values.reason,moderation:values.moderation}); state.notice = "Assessment plan drafted for approval."; return result;
    });
    submit("[data-exam-order-submit]",async (form,values) => {const result = await api("POST",`${base}/orders`,{...values,durationMinutes:Number(values.durationMinutes)}); state.notice = "Exam order submitted for review."; return result;});
    submit("[data-plan-approve]",async (form,values) => {const result = await api("POST",`/api/assessment/plans/${form.dataset.planApprove}/approve`,values); state.notice = "Assessment plan approved."; return result;});
    submit("[data-assessment-marks]",async (form) => {
      const fields = Object.fromEntries(new FormData(form)),entries = [];
      for (const [name,value] of Object.entries(fields)) {
        if (!name.startsWith("state:") || !value) continue;
        const key = name.slice(6),[registrationId,componentCode] = key.split("|"),current = data.students.find((row) => row.registrationId === registrationId)?.entries[componentCode];
        const entry = {registrationId,componentCode,state:value,revision:Number(fields[`revision:${key}`])};
        if (value === "mark") entry.mark = Number(fields[`mark:${key}`]); else entry.reason = fields[`reason:${key}`];
        const unchanged = current && current.state === entry.state && (value === "mark" ? current.mark === entry.mark : current.reason === entry.reason);
        if (!unchanged) entries.push(entry);
      }
      if (!entries.length) throw new Error("No mark changes to save.");
      const result = await api("PUT",`${base}/marks`,{planId:data.plan.id,entries}); state.notice = `${entries.length} mark(s) saved.`; return result;
    });
    root.querySelector("[data-marks-template]")?.addEventListener("click",() => {
      const lines = [["student_number","component","value","reason"]];
      for (const student of data.students) for (const component of data.plan.components) {
        const entry = student.entries[component.code];
        lines.push([student.studentNumber,component.code,entry ? (entry.state === "mark" ? entry.mark : entry.state.toUpperCase()) : "",entry?.reason || ""]);
      }
      const url = URL.createObjectURL(new Blob([lines.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n"],{type:"text/csv"}));
      const link = document.createElement("a"); link.href = url; link.download = `marks-${data.offering.code}-plan-v${data.plan.version}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
    });
    root.querySelector("[data-marks-import]")?.addEventListener("submit",(event) => {
      event.preventDefault(); const values = new FormData(event.target),file = values.get("file");
      act(async () => {
        if (!file || !file.size) throw new Error("Choose a CSV mark file.");
        if (file.size > 1_000_000) throw new Error("Mark files must be under 1 MB.");
        const [header,...lines] = parseCsv(await file.text());
        const columns = (header || []).map((cell) => cell.trim().toLowerCase().replace(/^\ufeff/,""));
        const at = (name) => columns.indexOf(name);
        if (["student_number","component","value"].some((name) => at(name) < 0)) throw new Error("The file needs student_number, component, and value columns.");
        const rows = lines.map((cells) => ({studentNumber:cells[at("student_number")] ?? "",componentCode:cells[at("component")] ?? "",value:cells[at("value")] ?? "",reason:at("reason") < 0 ? "" : cells[at("reason")] ?? ""}));
        if (!rows.length) throw new Error("The file has no mark rows.");
        const sourceRef = String(values.get("sourceRef") || "").trim() || file.name;
        const result = await api("POST",`${base}/imports`,{mode:"preview",planId:data.plan.id,sourceRef,rows});
        if (result.replayed) {state.assessment = result.context; state.markImport = null; state.notice = `${sourceRef} was already applied (${result.import.applied} change(s)).`; return;}
        state.markImport = {...result,planId:data.plan.id,rows};
        state.notice = result.rejected.length ? `${result.rejected.length} row(s) rejected. Nothing was saved.` : "Upload previewed. Review the changes, then apply.";
      });
    });
    root.querySelector("[data-marks-apply]")?.addEventListener("click",() => act(async () => {
      const preview = state.markImport;
      const result = await api("POST",`${base}/imports`,{mode:"apply",planId:preview.planId,sourceRef:preview.sourceRef,rows:preview.rows,baseline:preview.baseline});
      state.assessment = result.context; state.markImport = null;
      state.notice = result.replayed ? `${preview.sourceRef} was already applied.` : `${result.import.applied} mark(s) uploaded from ${preview.sourceRef}.`;
    }));
    submit("[data-assessment-submit]",async (form,values) => {const result = await api("POST",`${base}/submit`,{planId:data.plan.id,reason:values.reason}); state.notice = "Marks submitted for review."; return result;});
    submit("[data-submission-review]",async (form,values) => {const result = await api("POST",`/api/assessment/submissions/${form.dataset.submissionReview}/review`,values); state.notice = `Marks ${values.outcome}.`; return result;});
    submit("[data-moderation]",async (form,values) => {const result = await api("POST",`/api/assessment/submissions/${form.dataset.moderation}/moderation`,{...values,stage:form.dataset.stage}); state.notice = "Moderation decision recorded."; return result;});
  }
  window.registryAssessmentUI = {render,bind,load};
})();
