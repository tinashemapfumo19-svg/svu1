(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const money = (currency,minor) => `${currency} ${(Number(minor) / 100).toFixed(2)}`;
  // Sponsor directory: each sponsor's statement (owed from transfers, paid, balance), new sponsors, and sponsor payments.
  function renderDirectory(state) {
    const data = state.sponsors;
    if (!data) return "";
    return `<details class="registry-sponsors" data-sponsors-panel ${state.sponsorsOpen ? "open" : ""}><summary>Sponsors (${data.sponsors.length})</summary>
      <ul class="sponsor-list">${data.sponsors.map((row) => `<li data-sponsor="${esc(row.code)}"><strong>${esc(row.name)}</strong> ${row.contactEmail ? `- ${esc(row.contactEmail)}` : ""}
        <span data-sponsor-statement>${row.statement.length ? row.statement.map((line) => `${money(line.currency,line.charged)} owed, ${money(line.currency,line.paid)} paid, balance ${money(line.currency,line.balance)}`).join("; ") : "Nothing owed yet"}</span>
        ${data.capabilities.recordPayment ? `<details><summary>Record sponsor payment</summary><form class="form form-grid" data-sponsor-payment="${esc(row.id)}">
          <label class="field"><span>Currency</span><input class="input" name="currency" maxlength="3" value="USD" required></label><label class="field"><span>Amount</span><input class="input" name="amount" inputmode="decimal" required></label>
          <label class="field"><span>Reference</span><input class="input" name="externalRef" maxlength="120" required></label><label class="field"><span>Received on</span><input class="input" type="date" name="receivedOn" required></label>
          <label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Record payment</button></div></form></details>` : ""}</li>`).join("")}</ul>
      ${data.capabilities.manage ? `<details><summary>Add sponsor</summary><form class="form form-grid" data-sponsor-create><label class="field"><span>Code</span><input class="input" name="code" pattern="[a-z0-9_]{3,40}" required></label>
        <label class="field"><span>Name</span><input class="input" name="name" maxlength="200" required></label><label class="field"><span>Contact email</span><input class="input" type="email" name="contactEmail"></label>
        <label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Add sponsor</button></div></form></details>` : ""}
    </details>`;
  }
  // Per-student sponsorships: request, independent approval (which moves covered amounts to the sponsor), and ending.
  function renderProgramme(state) {
    const data = state.sponsorships;
    if (!data) return "";
    const can = data.capabilities;
    return `<section class="registry-sponsorships" data-sponsorships><h3>Sponsorships</h3>
      ${data.sponsorships.length ? data.sponsorships.map((row) => `<article data-sponsorship="${row.id}"><header class="section-header"><h4>${esc(row.sponsorName)}: ${row.coveragePercent}% of ${row.chargeCodes.length ? esc(row.chargeCodes.join(", ")) : "all charges"} in ${esc(row.currency)}</h4><strong data-sponsorship-status>${esc(row.status)}</strong></header>
        <p>${esc(row.validFrom)} to ${esc(row.validTo)}${row.capMinor ? `, cap ${money(row.currency,row.capMinor)}` : ""} - transferred ${money(row.currency,row.transferredMinor)}</p>
        ${can.approve && row.status === "requested" && row.requestedBy !== data.accountId ? `<form class="form form-grid" data-sponsorship-review="${row.id}"><label class="field"><span>Sponsorship decision</span><select class="input" name="outcome"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
          <label class="field"><span>Decision reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Record sponsorship decision</button></div></form>` : ""}
        ${can.request && ["requested","approved"].includes(row.status) ? `<details><summary>End sponsorship</summary><form class="form form-grid" data-sponsorship-end="${row.id}"><label class="field"><span>End reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-secondary" type="submit">End sponsorship</button></div></form></details>` : ""}
      </article>`).join("") : "<p>No sponsorships.</p>"}
      ${can.request && data.sponsors.length ? `<details><summary>Propose a sponsorship</summary><form class="form form-grid" data-sponsorship-request>
        <label class="field"><span>Sponsor</span><select class="input" name="sponsorId">${data.sponsors.map((row) => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Currency</span><input class="input" name="currency" maxlength="3" value="USD" required></label><label class="field"><span>Coverage %</span><input class="input" type="number" name="coveragePercent" min="1" max="100" required></label>
        <label class="field"><span>Charge codes (comma separated, blank for all)</span><input class="input" name="chargeCodes"></label><label class="field"><span>Cap (blank for none)</span><input class="input" name="cap" inputmode="decimal"></label>
        <label class="field"><span>Valid from</span><input class="input" type="date" name="validFrom" required></label><label class="field"><span>Valid to</span><input class="input" type="date" name="validTo" required></label>
        <label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Request sponsorship</button></div></form></details>` : ""}
    </section>`;
  }
  const minor = (value) => Math.round(Number(value) * 100);
  async function loadDirectory(state,api) { state.sponsors = await api("GET","/api/finance/sponsors").catch(() => null); }
  async function loadProgramme(state,api,id) { state.sponsorships = await api("GET",`/api/finance/programmes/${id}/sponsorships`).catch(() => null); }
  function bind(root,state,{api,act,loadDetail}) {
    root.querySelector("[data-sponsors-panel]")?.addEventListener("toggle",(event) => {if (event.currentTarget.isConnected) state.sponsorsOpen = event.currentTarget.open;});
    const form = (selector,work) => root.querySelectorAll(selector).forEach((node) => node.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(node));
      act(async () => {const notice = await work(values,node); await loadDirectory(state,api); if (state.detail) await loadDetail(state.detail.id); state.notice = notice;});
    }));
    form("[data-sponsor-create]",async (values) => {await api("POST","/api/finance/sponsors",{code:values.code,name:values.name,...(values.contactEmail ? {contactEmail:values.contactEmail} : {}),reason:values.reason}); return "Sponsor added.";});
    form("[data-sponsor-payment]",async (values,node) => {
      await api("POST",`/api/finance/sponsors/${node.dataset.sponsorPayment}/payments`,{currency:values.currency.toUpperCase(),amountMinor:minor(values.amount),externalRef:values.externalRef,receivedOn:values.receivedOn,reason:values.reason});
      return "Sponsor payment recorded.";
    });
    if (!state.detail) return;
    const base = `/api/finance/programmes/${state.detail.id}/sponsorships`;
    form("[data-sponsorship-request]",async (values) => {
      await api("POST",base,{sponsorId:values.sponsorId,currency:values.currency.toUpperCase(),coveragePercent:Number(values.coveragePercent),
        chargeCodes:values.chargeCodes.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean),...(values.cap ? {capMinor:minor(values.cap)} : {}),validFrom:values.validFrom,validTo:values.validTo,reason:values.reason});
      return "Sponsorship requested for independent approval.";
    });
    form("[data-sponsorship-review]",async (values,node) => {
      const result = await api("POST",`${base}/${node.dataset.sponsorshipReview}/review`,values);
      return values.outcome === "approved" ? `Sponsorship approved; ${result.transfers.length} charge(s) moved to the sponsor.` : "Sponsorship rejected.";
    });
    form("[data-sponsorship-end]",async (values,node) => {await api("POST",`${base}/${node.dataset.sponsorshipEnd}/end`,values); return "Sponsorship ended.";});
  }
  window.registrySponsorsUI = {renderDirectory,renderProgramme,loadDirectory,loadProgramme,bind};
})();
