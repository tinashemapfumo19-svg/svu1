(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const money = (currency,minor) => `${currency} ${(Number(minor) / 100).toFixed(2)}`;
  async function checksum(lines) {
    const bytes = new TextEncoder().encode(JSON.stringify(lines.map((line) => [line.externalRef,line.amountMinor,line.receivedOn,line.payerReference])));
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map((byte) => byte.toString(16).padStart(2,"0")).join("");
  }
  // One line per payment: reference,amount,received date,payer reference (the payer reference may contain commas).
  function parseLines(textValue) {
    return textValue.split(/\r?\n/).map((row) => row.trim()).filter(Boolean).map((row,index) => {
      const [externalRef,amount,receivedOn,...payer] = row.split(",").map((cell) => cell.trim());
      if (!externalRef || !amount || !receivedOn) throw new Error(`Statement line ${index + 1} needs reference, amount, and received date.`);
      return {externalRef,amountMinor:Math.round(Number(amount) * 100),receivedOn,payerReference:payer.join(",").trim()};
    });
  }
  function render(state) {
    const data = state.imports;
    if (!data) return "";
    return `<section class="finance-imports"><header class="section-header"><h2>Payment statements</h2><span>${data.queue.length} unmatched</span></header>
      <details><summary>Import statement</summary><form class="form form-grid" data-statement-import>
        <label class="field"><span>Statement source</span><select class="input" name="source"><option value="bank">Bank</option><option value="mobile_money">Mobile money</option></select></label>
        <label class="field"><span>Statement reference</span><input class="input" name="sourceRef" maxlength="120" required></label>
        <label class="field"><span>Statement currency</span><input class="input" name="currency" maxlength="3" pattern="[A-Z]{3}" value="USD" required></label>
        <label class="field"><span>Expected line count</span><input class="input" name="expectedLineCount" type="number" min="1" required></label>
        <label class="field"><span>Expected total</span><input class="input" name="expectedTotal" type="number" min="0.01" step="0.01" required></label>
        <label class="field"><span>Statement lines (reference, amount, date, payer reference)</span><textarea class="input" name="lines" rows="5" required></textarea></label>
        <label class="field"><span>Import reason</span><input class="input" name="reason" maxlength="2000" required></label>
        <div><button class="button button-primary" type="submit">Import statement</button></div></form></details>
      ${data.imports.length ? `<ul class="statement-list">${data.imports.map((row) => `<li data-statement="${row.id}"><strong>${esc(row.sourceRef)}</strong><span>${esc(row.source.replace("_"," "))} - ${row.lineCount} line(s) - ${esc(money(row.currency,row.totalMinor))}</span><span>${Object.entries(row.counts).map(([status,count]) => `${count} ${esc(status)}`).join(", ")}</span></li>`).join("")}</ul>` : ""}
      ${data.queue.map((line) => `<section class="statement-line" data-statement-line="${line.id}"><header class="section-header"><h3>${esc(line.externalRef)} - ${esc(money(line.currency,line.amountMinor))}</h3><span>${esc(line.receivedOn)}</span></header>
        <p>${esc(line.sourceRef)} line ${line.lineNo}: "${esc(line.payerReference)}"</p><p>${esc(line.matchNote)}</p>
        ${line.importedBy !== data.accountId ? `<form class="form form-grid" data-statement-resolve="${line.id}">
          <label class="field"><span>Resolution</span><select class="input" name="action"><option value="assign">Assign to student</option><option value="return">Returned to payer</option></select></label>
          <label class="field"><span>Assign to student number</span><input class="input" name="studentNumber" pattern="S[0-9]{8}"></label>
          <label class="field"><span>Resolution reason</span><input class="input" name="reason" maxlength="2000" required></label>
          <div><button class="button button-secondary" type="submit">Resolve line</button></div></form>` : "<p>Another finance officer must resolve lines you imported.</p>"}
      </section>`).join("")}
    </section>`;
  }
  async function load(state,api) {
    state.imports = await api("GET","/api/finance/payment-imports").catch(() => null);
  }
  function bind(root,state,{api,act}) {
    root.querySelector("[data-statement-import]")?.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
      act(async () => {
        const lines = parseLines(values.lines);
        const result = await api("POST","/api/finance/payment-imports",{source:values.source,sourceRef:values.sourceRef,currency:values.currency,reason:values.reason,
          expectedLineCount:Number(values.expectedLineCount),expectedTotalMinor:Math.round(Number(values.expectedTotal) * 100),checksum:await checksum(lines),lines});
        await load(state,api);
        state.notice = `Statement imported: ${result.matched} matched, ${result.unmatched} unmatched, ${result.duplicate} duplicate.`;
      });
    });
    root.querySelectorAll("[data-statement-resolve]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      const body = values.action === "assign" ? {action:"assign",studentNumber:values.studentNumber,reason:values.reason} : {action:"return",reason:values.reason};
      act(async () => {await api("POST",`/api/finance/payment-imports/lines/${form.dataset.statementResolve}/resolve`,body); await load(state,api); state.notice = "Statement line resolved.";});
    }));
  }
  window.financeImportsUI = {render,bind,load,parseLines,checksum};
})();
