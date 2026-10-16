(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const money = (currency,minor) => `${currency} ${(Number(minor) / 100).toFixed(2)}`;
  const standingText = {current:"Current - covered fees are not holding registration",in_arrears:"In arrears - the hold applies again",completed:"Completed"};
  // Instalment plans for one student programme: request by finance, independent approval, live standing from the ledger.
  function render(state) {
    const data = state.paymentPlans;
    if (!data) return "";
    const can = data.capabilities,live = new Set(data.plans.filter((row) => ["requested","approved"].includes(row.status)).map((row) => row.currency));
    const owing = data.currencies.filter((row) => row.due > 0 || row.balance > 0).filter((row) => !live.has(row.currency));
    return `<section class="registry-plans" data-payment-plans><h3>Payment plans</h3>
      ${data.plans.length ? data.plans.map((plan) => `<article class="payment-plan" data-payment-plan="${plan.id}"><header class="section-header"><h4>${money(plan.currency,plan.coveredAmount)} in ${plan.instalments.length} instalments</h4><strong data-plan-status>${esc(plan.status)}</strong></header>
        ${plan.standing ? `<p data-plan-standing="${esc(plan.standing.status)}">${esc(standingText[plan.standing.status])}: paid ${money(plan.currency,plan.standing.paid)} of ${money(plan.currency,plan.standing.requiredToDate)} due so far${plan.standing.nextInstalment ? `; next ${money(plan.currency,plan.standing.nextInstalment.amountMinor)} on ${esc(plan.standing.nextInstalment.dueOn)}` : ""}</p>` : ""}
        <ul>${plan.instalments.map((row) => `<li>${esc(row.dueOn)}: ${money(plan.currency,row.amountMinor)}</li>`).join("")}</ul><p>${esc(plan.reason)}${plan.reviewReason ? ` - ${esc(plan.reviewReason)}` : ""}${plan.cancelReason ? ` - cancelled: ${esc(plan.cancelReason)}` : ""}</p>
        ${can.approve && plan.status === "requested" && plan.requestedBy !== data.accountId ? `<form class="form form-grid" data-plan-review="${plan.id}"><label class="field"><span>Plan decision</span><select class="input" name="outcome"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
          <label class="field"><span>Decision reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Record plan decision</button></div></form>` : ""}
        ${can.request && ["requested","approved"].includes(plan.status) ? `<details><summary>Cancel plan</summary><form class="form form-grid" data-plan-cancel="${plan.id}"><label class="field"><span>Cancellation reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-secondary" type="submit">Cancel plan</button></div></form></details>` : ""}
      </article>`).join("") : "<p>No payment plans.</p>"}
      ${can.request && owing.length ? `<details><summary>Propose a payment plan</summary><form class="form form-grid" data-plan-request>
        <label class="field"><span>Currency</span><select class="input" name="currency">${owing.map((row) => `<option value="${esc(row.currency)}">${esc(row.currency)} (balance ${money(row.currency,row.balance)})</option>`).join("")}</select></label>
        <label class="field"><span>Instalments (one per line: YYYY-MM-DD, amount)</span><textarea class="input" name="instalments" rows="4" required></textarea></label>
        <label class="field"><span>Plan reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Request plan</button></div></form></details>` : ""}
    </section>`;
  }
  async function load(state,api,programmeId) {
    state.paymentPlans = await api("GET",`/api/finance/programmes/${programmeId}/plans`).catch(() => null);
  }
  function bind(root,state,{api,act}) {
    if (!state.paymentPlans) return;
    const base = `/api/finance/programmes/${state.detail.id}/plans`;
    const form = (selector,work) => root.querySelectorAll(selector).forEach((node) => node.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(node));
      act(async () => {const notice = await work(values,node); await load(state,api,state.detail.id); state.notice = notice;});
    }));
    form("[data-plan-request]",async (values) => {
      // Amounts are entered in major units (for example 300.00) and sent as whole minor units.
      const instalments = values.instalments.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
        const [dueOn,amount] = line.split(",").map((cell) => cell.trim());
        return {dueOn,amountMinor:Math.round(Number(amount) * 100)};
      });
      await api("POST",base,{currency:values.currency,instalments,reason:values.reason});
      return "Payment plan requested for independent approval.";
    });
    form("[data-plan-review]",async (values,node) => {await api("POST",`${base}/${node.dataset.planReview}/review`,values); return values.outcome === "approved" ? "Payment plan approved." : "Payment plan rejected.";});
    form("[data-plan-cancel]",async (values,node) => {await api("POST",`${base}/${node.dataset.planCancel}/cancel`,values); return "Payment plan cancelled.";});
  }
  window.registryPlansUI = {render,load,bind};
})();
