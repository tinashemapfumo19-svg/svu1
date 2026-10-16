(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const money = (currency,minor) => `${currency} ${(Number(minor) / 100).toFixed(2)}`;
  const toMinor = (value) => Math.round(Number(value) * 100);
  function summary(account) {
    return `${account.currencies.length ? `<dl class="finance-summary">${account.currencies.map((row) => `<div><dt>${esc(row.currency)} balance</dt><dd>${esc(money(row.currency,row.balance))}</dd></div><div><dt>Due now</dt><dd>${esc(money(row.currency,row.due))}</dd></div><div><dt>Unallocated credit</dt><dd>${esc(money(row.currency,row.credit))}</dd></div>`).join("")}</dl>` : "<p>No charges or payments recorded.</p>"}
      <p data-finance-hold>${account.hold.held ? `Financial hold: ${account.hold.reasons.map((row) => esc(row.message)).join(" ")}` : account.hold.exemption ? `Financial hold exempted until ${esc(account.hold.exemption.expiresOn)}: ${account.hold.reasons.map((row) => esc(row.message)).join(" ")}` : "No financial hold."}</p>
      ${account.entries.length ? `<ul class="finance-ledger">${[...account.entries].reverse().map((row) => `<li data-ledger-entry="${row.id}"><span>${esc(row.entryType === "charge" ? `Due ${row.dueOn}` : row.entryType === "credit" ? "Approved adjustment" : `Received ${row.receivedOn}`)}</span><span>${esc(row.description)}</span><strong>${row.entryType !== "charge" ? "-" : ""}${esc(money(row.currency,row.amountMinor))}</strong><span>${row.entryType === "charge" ? (row.outstanding ? `${esc(money(row.currency,row.outstanding))} outstanding` : "Paid") : row.unallocated ? `${esc(money(row.currency,row.unallocated))} unallocated` : "Allocated"}</span></li>`).join("")}</ul>` : ""}`;
  }
  const kinds = {waiver:"Fee waiver",scholarship:"Scholarship",write_off:"Write-off",debit:"Manual debit",refund:"Refund",hold_exemption:"Hold exemption"};
  function adjustments(state) {
    const data = state.adjustments,account = state.account;
    if (!data) return "";
    const open = data.adjustments.some((row) => row.status === "requested");
    const charges = account.entries.filter((row) => row.entryType === "charge" && row.outstanding > 0 && !["REFUND","ADJUSTMENT"].includes(row.chargeCode));
    return `<h4>Adjustments</h4>
      ${data.capabilities.request && !open ? `<details><summary>Request adjustment</summary><form class="form form-grid" data-adjustment-request>
        <label class="field"><span>Adjustment type</span><select class="input" name="kind">${Object.entries(kinds).map(([value,label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
        <label class="field" data-adjust="credit"><span>Charge to credit</span><select class="input" name="targetEntryId">${charges.map((row) => `<option value="${row.id}">${esc(row.description)} - ${esc(money(row.currency,row.outstanding))} outstanding</option>`).join("")}</select></label>
        <label class="field" data-adjust="amount"><span>Adjustment amount</span><input class="input" name="amount" type="number" min="0.01" step="0.01"></label>
        <label class="field" data-adjust="currency"><span>Adjustment currency</span><input class="input" name="currency" maxlength="3" value="${esc(account.currencies[0]?.currency || "USD")}"></label>
        <label class="field" data-adjust="debit"><span>Debit description</span><input class="input" name="description" maxlength="200"></label>
        <label class="field" data-adjust="debit"><span>Debit due on</span><input class="input" name="dueOn" type="date"></label>
        <label class="field" data-adjust="exemption"><span>Exemption expires</span><input class="input" name="expiresOn" type="date"></label>
        <label class="field"><span>Adjustment evidence</span><input class="input" name="evidenceRef" maxlength="300" required></label>
        <label class="field"><span>Adjustment reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>
        <div><button class="button button-primary" type="submit">Request adjustment</button></div></form></details>` : ""}
      ${data.adjustments.map((row) => `<section class="finance-adjustment" data-adjustment="${row.id}"><header class="section-header"><h4>${kinds[row.kind]}${row.amountMinor ? ` - ${esc(money(row.currency,row.amountMinor))}` : ` until ${esc(row.expiresOn)}`}</h4><strong>${esc(row.status)}</strong></header>
        <p>${esc(row.reason)}</p><p>Evidence: ${esc(row.evidenceRef)}</p>${row.reviewReason ? `<p>${esc(row.reviewReason)}</p>` : ""}${row.revokeReason ? `<p>Revoked: ${esc(row.revokeReason)}</p>` : ""}
        ${data.capabilities.approve && row.status === "requested" && row.requestedBy !== data.accountId ? `<form class="form" data-adjustment-review="${row.id}"><label class="field"><span>Adjustment outcome</span><select class="input" name="outcome"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
          <label class="field"><span>Adjustment review reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><div><button class="button button-primary" type="submit">Review adjustment</button></div></form>` : ""}
        ${data.capabilities.approve && row.status === "approved" && row.kind === "hold_exemption" ? `<form class="form" data-adjustment-revoke="${row.id}"><label class="field"><span>Revocation reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-secondary" type="submit">Revoke exemption</button></div></form>` : ""}
      </section>`).join("")}`;
  }
  function render(state) {
    const data = state.account;
    if (!data) return "";
    const lines = state.chargeTypes || [];
    return `<section class="registry-finance"><header class="section-header"><h3>Student account</h3><button class="button button-secondary" type="button" data-finance-refresh>Refresh account</button></header>
      ${summary(data)}
      ${data.capabilities.recordPayment ? `<details><summary>Record payment</summary><form class="form form-grid" data-finance-payment>
        <label class="field"><span>Payment currency</span><input class="input" name="currency" maxlength="3" pattern="[A-Z]{3}" value="${esc(data.currencies[0]?.currency || "USD")}" required></label>
        <label class="field"><span>Amount</span><input class="input" name="amount" type="number" min="0.01" step="0.01" required></label>
        <label class="field"><span>Method</span><select class="input" name="method"><option value="bank">Bank</option><option value="mobile_money">Mobile money</option><option value="cash">Cash</option></select></label>
        <label class="field"><span>External reference</span><input class="input" name="externalRef" maxlength="120" required></label>
        <label class="field"><span>Received on</span><input class="input" name="receivedOn" type="date" required></label>
        <label class="field"><span>Payment reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>
        <div><button class="button button-primary" type="submit">Record payment</button></div></form></details>` : ""}
      ${adjustments(state)}
      <h4>Fee schedules</h4>
      ${data.schedules.length ? data.schedules.map((row) => `<section class="fee-schedule" data-fee-schedule="${esc(row.id)}"><header class="section-header"><h4>Year ${row.yearOfStudy} ${esc(row.term)} - ${esc(row.currency)} from ${esc(row.effectiveFrom)}</h4><strong>${esc(row.status)}</strong></header>
        <ul>${row.lines.map((line) => `<li>${esc(line.chargeCode)} - ${esc(line.description)}: ${esc(money(row.currency,line.amountMinor))}</li>`).join("")}</ul><p>Due ${row.dueDays} day(s) after period start. ${esc(row.reason)}</p>
        ${data.capabilities.publishSchedules && row.status === "draft" && row.createdBy !== data.accountId ? `<form class="form" data-fee-publish="${esc(row.id)}"><label class="field"><span>Publication reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><div><button class="button button-primary" type="submit">Publish fee schedule</button></div></form>` : ""}
      </section>`).join("") : "<p>No fee schedules for this programme.</p>"}
      ${data.capabilities.manageSchedules ? `<details><summary>Draft fee schedule</summary><form class="form form-grid" data-fee-draft>
        <label class="field"><span>Study year</span><input class="input" name="yearOfStudy" type="number" min="1" max="8" value="1" required></label>
        <label class="field"><span>Term</span><select class="input" name="term"><option>S1</option><option>S2</option><option>S3</option></select></label>
        <label class="field"><span>Schedule currency</span><input class="input" name="currency" maxlength="3" pattern="[A-Z]{3}" value="USD" required></label>
        <label class="field"><span>Effective from</span><input class="input" name="effectiveFrom" type="date" required></label>
        <label class="field"><span>Due days after period start</span><input class="input" name="dueDays" type="number" min="0" max="365" value="14" required></label>
        ${[0,1,2].map((index) => `<label class="field"><span>Charge ${index + 1}</span><select class="input" name="chargeCode${index}"><option value="">None</option>${lines.map((line) => `<option value="${esc(line.valueCode)}">${esc(line.label)}</option>`).join("")}</select></label>
        <label class="field"><span>Charge ${index + 1} amount</span><input class="input" name="amount${index}" type="number" min="0.01" step="0.01"></label>`).join("")}
        <label class="field"><span>Schedule reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>
        <div><button class="button button-primary" type="submit">Draft fee schedule</button></div></form></details>` : ""}
      <h4>Period billing</h4>
      ${data.periods.length ? data.periods.map((row) => `<section class="billing-period"><header class="section-header"><h4>${esc(row.name)} - Year ${row.yearOfStudy} ${esc(row.term)}</h4><strong>${esc(row.status)}</strong></header>
        ${row.billingRuns.map((run) => `<p>Billing run ${run.id}: ${run.chargesCreated} charge(s) created</p>`).join("")}
        ${data.capabilities.runBilling && row.status !== "closed" ? `<form class="form" data-billing-run="${esc(row.id)}"><label class="field"><span>Billing reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-secondary" type="submit">Run billing</button></div></form>` : ""}
      </section>`).join("") : "<p>No registration periods for this intake.</p>"}
    </section>`;
  }
  async function loadAccount(state,api) {
    state.account = await api("GET",`/api/registry/programmes/${state.detail.id}/account`).catch(() => null);
    state.adjustments = state.account ? await api("GET",`/api/registry/programmes/${state.detail.id}/adjustments`) : null;
    if (state.account?.capabilities.manageSchedules && !state.chargeTypes) state.chargeTypes = (await api("GET","/api/master-data/reference-lists/charge_type")).values.filter((row) => row.status === "active");
  }
  function bind(root,state,{api,act,loadDetail}) {
    const id = state.detail.id;
    root.querySelector("[data-finance-refresh]")?.addEventListener("click",() => act(() => loadDetail(id)));
    const submit = (selector,work) => root.querySelectorAll(selector).forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      act(async () => {state.notice = await work(form,values); await loadDetail(id);});
    }));
    submit("[data-finance-payment]",async (form,values) => {
      const result = await api("POST",`/api/registry/programmes/${id}/payments`,{currency:values.currency,amountMinor:toMinor(values.amount),method:values.method,externalRef:values.externalRef,receivedOn:values.receivedOn,reason:values.reason});
      return `Payment recorded. Receipt ${result.receiptNumber}.`;
    });
    submit("[data-fee-draft]",async (form,values) => {
      const lines = [0,1,2].filter((index) => values[`chargeCode${index}`]).map((index) => ({chargeCode:values[`chargeCode${index}`],description:form.elements[`chargeCode${index}`].selectedOptions[0].textContent,amountMinor:toMinor(values[`amount${index}`])}));
      await api("POST","/api/finance/fee-schedules",{programmeId:state.account.catalogueProgrammeId,yearOfStudy:Number(values.yearOfStudy),term:values.term,currency:values.currency,effectiveFrom:values.effectiveFrom,dueDays:Number(values.dueDays),lines,reason:values.reason});
      return "Fee schedule drafted.";
    });
    const request = root.querySelector("[data-adjustment-request]");
    if (request) {
      const update = () => {
        const kind = request.elements.kind.value,show = {credit:["waiver","scholarship","write_off"].includes(kind),amount:kind !== "hold_exemption",currency:["debit","refund"].includes(kind),debit:kind === "debit",exemption:kind === "hold_exemption"};
        request.querySelectorAll("[data-adjust]").forEach((field) => {field.hidden = !show[field.dataset.adjust]; field.querySelectorAll("input,select").forEach((input) => {input.disabled = field.hidden; input.required = !field.hidden;});});
      };
      request.elements.kind.addEventListener("change",update); update();
    }
    submit("[data-adjustment-request]",async (form,values) => {
      const body = {kind:values.kind,evidenceHash:state.adjustments.evidenceHash,evidenceRef:values.evidenceRef,reason:values.reason};
      if (values.targetEntryId) body.targetEntryId = Number(values.targetEntryId);
      if (values.amount) body.amountMinor = toMinor(values.amount);
      for (const key of ["currency","description","dueOn","expiresOn"]) if (values[key]) body[key] = values[key];
      await api("POST",`/api/registry/programmes/${id}/adjustments`,body); return "Adjustment requested.";
    });
    submit("[data-adjustment-review]",async (form,values) => {await api("POST",`/api/registry/programmes/${id}/adjustments/${form.dataset.adjustmentReview}/review`,values); return "Adjustment reviewed.";});
    submit("[data-adjustment-revoke]",async (form,values) => {await api("POST",`/api/registry/programmes/${id}/adjustments/${form.dataset.adjustmentRevoke}/review`,{outcome:"revoked",reason:values.reason}); return "Hold exemption revoked.";});
    submit("[data-fee-publish]",async (form,values) => {await api("POST",`/api/finance/fee-schedules/${form.dataset.feePublish}/publish`,values); return "Fee schedule published.";});
    submit("[data-billing-run]",async (form,values) => {
      const run = await api("POST","/api/finance/billing-runs",{registrationPeriodId:form.dataset.billingRun,reason:values.reason});
      return `Billing complete: ${run.chargesCreated} charge(s) for ${run.students} student(s).`;
    });
  }
  window.registryFinanceUI = {render,bind,loadAccount,summary};
})();
