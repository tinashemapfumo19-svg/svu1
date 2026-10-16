(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const when = (value) => value ? window.svuUI.dateTime(value) : "never";
  // Integration governance for operators: the connection catalogue with health, contract checks, and the delivery queue.
  function render(state) {
    const data = state.integrations;
    if (!data) return "";
    const can = data.capabilities.manage,queue = state.integrationQueue || [],mail=state.emailDeliveries;
    return `<details class="registry-integrations" data-integrations-panel ${state.integrationsOpen ? "open" : ""}><summary>Integrations (${data.connections.filter((row) => row.health.dead).length} with dead letters)</summary>
      <div class="result-table-wrap"><table class="result-table"><thead><tr><th>Connection</th><th>Owner</th><th>Status</th><th>Health</th></tr></thead><tbody>
      ${data.connections.map((row) => `<tr data-integration="${esc(row.code)}"><td><strong>${esc(row.name)}</strong><br>${esc(row.counterparty)}<br><span class="muted">${esc(row.classification)}${row.agreementRef ? ` - ${esc(row.agreementRef)}` : " - no agreement recorded"}</span></td>
        <td>${esc(row.owner)}</td><td data-integration-status>${esc(row.status)}${row.adapter === "development" ? " (development adapter)" : ""}</td>
        <td>${row.health.pending} pending, <span data-integration-dead>${row.health.dead}</span> dead, ${row.health.deliveredLastDay} delivered today<br><span class="muted">last delivery ${esc(when(row.health.lastDeliveredAt))}</span></td></tr>`).join("")}</tbody></table></div>
      ${can ? `<form class="form form-grid" data-integration-check><label class="field"><span>Connection</span><select class="input" name="code">${data.connections.filter((row) => row.status !== "retired").map((row) => `<option value="${esc(row.code)}">${esc(row.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" value="Routine contract check" required></label><div><button class="button button-secondary" type="submit">Run contract check</button></div></form>
        <form class="form form-grid" data-integration-status-form><label class="field"><span>Connection</span><select class="input" name="code">${data.connections.filter((row) => row.status !== "retired").map((row) => `<option value="${esc(row.code)}">${esc(row.name)}</option>`).join("")}</select></label>
        <label class="field"><span>New status</span><select class="input" name="status"><option value="active">Active</option><option value="suspended">Suspended</option><option value="planned">Planned</option><option value="retired">Retired (final)</option></select></label>
        <label class="field"><span>Agreement reference (needed to activate non-public data)</span><input class="input" name="agreementRef" maxlength="500"></label>
        <label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-secondary" type="submit">Change status</button></div></form>` : ""}
      <h3>Delivery queue</h3>
      <div class="button-row"><button class="button button-secondary" type="button" data-integration-queue="dead">Show dead letters</button><button class="button button-secondary" type="button" data-integration-queue="pending">Show pending</button>${can ? `<button class="button button-primary" type="button" data-integration-process>Run delivery worker</button>` : ""}</div>
      ${queue.length ? `<ul class="integration-queue">${queue.map((row) => `<li data-integration-message="${row.id}"><strong>${esc(row.connectionCode)}</strong> ${esc(row.operation)} - ${esc(row.status)} after ${row.attempts} attempt(s)${row.lastError ? ` - ${esc(row.lastError)}` : ""}
        ${can && row.status === "dead" ? `<form class="form form-grid" data-integration-retry="${row.id}"><label class="field"><span>Retry reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-secondary" type="submit">Retry</button></div></form>` : ""}
        ${can && ["pending","dead"].includes(row.status) ? `<form class="form form-grid" data-integration-cancel="${row.id}"><label class="field"><span>Cancel reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-secondary" type="submit">Cancel message</button></div></form>` : ""}</li>`).join("")}</ul>` : state.integrationQueue ? "<p>No messages in this view.</p>" : ""}
    </details>${mail ? `<details data-email-panel ${state.emailOpen ? 'open' : ''}><summary>Email delivery (${esc(mail.provider)} / ${mail.enabled ? 'enabled' : 'disabled'})</summary>
      <div class="button-row"><select class="input" data-email-status aria-label="Email delivery status">${['all','pending','accepted','delivered','bounced','complained','failed','dead','cancelled'].map(status=>`<option ${status===(state.emailStatus || 'all') ? 'selected' : ''}>${status}</option>`).join('')}</select>${mail.canManage ? '<button class="button button-secondary" data-email-process type="button">Process due emails</button>' : ''}</div>
      <ul class="email-delivery-list">${mail.items.map(row=>`<li data-email-id="${esc(row.id)}"><strong>${esc(row.templateCode || row.id)}</strong><span>${esc(row.status)} / ${row.attempts} attempts</span>${row.lastError ? `<span class="email-error">${esc(row.lastError)}</span>` : ''}<span class="muted">${row.status==='pending' ? 'Next attempt' : row.acceptedAt ? 'Accepted' : 'Updated'} ${esc(when(row.status==='pending' ? row.nextAttemptAt : row.acceptedAt || row.updatedAt))}</span>
        ${mail.canManage && ['pending','dead'].includes(row.status) ? `<form class="form form-grid" data-email-action="${esc(row.id)}"><label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label><div class="button-row">${row.canRetry ? '<button class="button button-secondary" name="operation" value="retry">Retry</button>' : ''}<button class="button button-secondary" name="operation" value="cancel">Cancel</button></div></form>` : ''}</li>`).join('')}</ul>
      <div class="button-row"><button class="button button-secondary" data-email-page="${Math.max(0,mail.offset-25)}" ${mail.offset===0 ? 'disabled' : ''} aria-label="Previous email page">Previous</button><span>${mail.total ? mail.offset+1 : 0}-${Math.min(mail.offset+25,mail.total)} of ${mail.total}</span><button class="button button-secondary" data-email-page="${mail.offset+25}" ${mail.offset+25>=mail.total ? 'disabled' : ''} aria-label="Next email page">Next</button></div></details>` : ''}`;
  }
  async function load(state,api) {
    state.integrations = await api("GET","/api/integrations").catch(() => null);
    state.emailDeliveries=await api('GET',`/api/email-delivery?status=${state.emailStatus || 'all'}&offset=${state.emailOffset || 0}`).catch(()=>null);
  }
  function bind(root,state,{api,act}) {
    root.querySelector('[data-email-panel]')?.addEventListener('toggle',event=>{if(event.currentTarget.isConnected)state.emailOpen=event.currentTarget.open;});
    root.querySelector('[data-email-status]')?.addEventListener('change',event=>{state.emailStatus=event.target.value;state.emailOffset=0;act(()=>load(state,api));});
    root.querySelectorAll('[data-email-page]').forEach(button=>button.addEventListener('click',()=>{state.emailOffset=Number(button.dataset.emailPage);act(()=>load(state,api));}));
    root.querySelector('[data-email-process]')?.addEventListener('click',()=>act(async()=>{const result=await api('POST','/api/email-delivery/process',{});await load(state,api);state.notice=result.configured ? `Email worker processed ${result.processed} emails.` : 'Email delivery is not enabled.';}));
    root.querySelectorAll('[data-email-action]').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();const row=state.emailDeliveries.items.find(item=>item.id===form.dataset.emailAction);const operation=event.submitter?.value;if(!operation)return;act(async()=>{await api('POST',`/api/email-delivery/${row.id}/${operation}`,{revision:row.revision,reason:new FormData(form).get('reason')});await load(state,api);state.notice=operation==='retry' ? 'Email queued for retry.' : 'Email cancelled.';});}));
    root.querySelector("[data-integrations-panel]")?.addEventListener("toggle",(event) => {if (event.currentTarget.isConnected) state.integrationsOpen = event.currentTarget.open;});
    const refresh = async (status = state.integrationQueueStatus) => {
      await load(state,api);
      if (status) {state.integrationQueueStatus = status; state.integrationQueue = await api("GET",`/api/integrations/outbox?status=${status}`);}
    };
    root.querySelectorAll("[data-integration-queue]").forEach((button) => button.addEventListener("click",() => act(() => refresh(button.dataset.integrationQueue))));
    root.querySelector("[data-integration-process]")?.addEventListener("click",() => act(async () => {
      const result = await api("POST","/api/integrations/outbox/process",{});
      await refresh(); state.notice = `Delivery worker processed ${result.processed} message(s).`;
    }));
    const form = (selector,work) => root.querySelectorAll(selector).forEach((node) => node.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(node)); act(async () => {state.notice = await work(values,node); await refresh();});
    }));
    form("[data-integration-check]",async (values) => {
      const result = await api("POST",`/api/integrations/connections/${values.code}/check`,{reason:values.reason});
      return {passed:"Contract check passed.",failed:`Contract check failed: ${result.detail || "no detail"}.`,not_configured:"No adapter is configured for this connection yet."}[result.outcome];
    });
    form("[data-integration-status-form]",async (values) => {
      const connection = state.integrations.connections.find((row) => row.code === values.code);
      await api("POST",`/api/integrations/connections/${connection.id}`,{revision:connection.revision,status:values.status,reason:values.reason,...(values.agreementRef ? {agreementRef:values.agreementRef} : {})});
      return `Connection ${connection.name} is now ${values.status}.`;
    });
    form("[data-integration-retry]",async (values,node) => {await api("POST",`/api/integrations/outbox/${node.dataset.integrationRetry}/retry`,values); return "Message queued for another attempt.";});
    form("[data-integration-cancel]",async (values,node) => {await api("POST",`/api/integrations/outbox/${node.dataset.integrationCancel}/cancel`,values); return "Message cancelled.";});
  }
  window.registryIntegrationsUI = {render,load,bind};
})();
