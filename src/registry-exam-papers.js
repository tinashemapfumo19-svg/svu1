(function () {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  const local = (value) => {const d = new Date(value),pad = (n) => String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;};
  const when = (value) => window.svuUI.dateTime(value);
  const reason = (label = 'Reason') => `<label class="field"><span>${label}</span><input class="input" name="reason" maxlength="2000" required></label>`;
  function own(state) {
    const rows = state.examPaperReleases;
    if (!rows?.length) return '';
    return `<section class="student-exams" data-own-paper-releases><header class="section-header"><h2>Exam paper packages</h2><button class="button button-secondary" type="button" data-paper-packages-refresh>Refresh</button></header>${rows.map((row) => {
      const available = row.eligible && Date.now() >= Date.parse(row.availableAt) && Date.now() < Date.parse(row.expiresAt);
      return `<details data-own-paper-release="${esc(row.id)}" ${state.ownPaperOpen?.[row.id] ? 'open' : ''}><summary>${esc(row.packageRef)} - ${row.copies} copies - ${row.status === 'revoked' ? 'Revoked' : !row.eligible ? 'Review required' : available ? 'Available' : Date.now() >= Date.parse(row.expiresAt) ? 'Expired' : 'Scheduled'}</summary>
        <p>${esc(row.fileName)} v${row.version} - ${esc(when(row.availableAt))} to ${esc(when(row.expiresAt))}</p>
        ${available ? `<form class="form form-grid" data-paper-recipient-download="${esc(row.id)}">${reason('Access purpose')}<div><button class="button button-secondary" type="submit">Download paper</button></div></form>` : ''}
        ${row.acknowledgedAt ? `<p data-paper-receipt>${esc(row.receiptRef)} - received ${esc(when(row.acknowledgedAt))}</p>` : row.eligible ? `<form class="form form-grid" data-paper-acknowledge="${esc(row.id)}"><label class="field"><span>Custody receipt reference</span><input class="input" name="receiptRef" maxlength="200" required></label>${reason('Receipt note')}<div><button class="button button-primary" type="submit">Acknowledge receipt</button></div></form>` : ''}</details>`;
    }).join('')}</section>`;
  }
  function render(state) {
    const data = state.examPapers;
    if (!data) return own(state);
    const can = data.capabilities;
    return `${own(state)}<section class="assessment-panel" data-paper-custody="${esc(data.order.id)}"><header class="section-header"><h2>${esc(data.offering.code)} ${esc(data.order.paper)} custody</h2><button class="button button-secondary" type="button" data-paper-custody-close>Close</button></header>
      ${data.papers.map((row) => `<details data-paper-version="${esc(row.id)}" ${state.examPaperOpen?.[row.id] ? 'open' : ''}><summary>v${row.version} - ${esc(row.fileName)} - ${esc(row.status)} - scan ${esc(row.scanStatus)}</summary>
        <p class="paper-checksum">SHA-256 ${esc(row.checksum)}</p><p>${esc(row.reason)}${row.reviewReason ? ` - ${esc(row.reviewReason)}` : ''}</p>
        ${can.scan && row.status === 'uploaded' && row.scanStatus === 'pending' ? `<form class="form form-grid" data-paper-action="scan" data-paper-id="${esc(row.id)}" data-revision="${row.revision}"><label class="field"><span>Scan result</span><select class="input" name="result"><option value="clean">Clean</option><option value="infected">Infected</option></select></label><label class="field"><span>Scanner reference</span><input class="input" name="scannerRef" maxlength="200" required></label><input type="hidden" name="checksum" value="${esc(row.checksum)}">${reason('Scan reason')}<div><button class="button button-primary" type="submit">Record scan</button></div></form>` : ''}
        ${can.upload && row.createdBy === data.accountId && row.status === 'uploaded' && row.scanStatus === 'clean' ? `<form class="form form-grid" data-paper-action="submit" data-paper-id="${esc(row.id)}" data-revision="${row.revision}">${reason('Submission reason')}<div><button class="button button-primary" type="submit">Submit paper</button></div></form>` : ''}
        ${can.review && row.status === 'submitted' && row.createdBy !== data.accountId ? `<form class="form form-grid" data-paper-action="review" data-paper-id="${esc(row.id)}" data-revision="${row.revision}"><label class="field"><span>Paper decision</span><select class="input" name="outcome"><option value="approved">Approve</option><option value="returned">Return for changes</option></select></label>${reason('Review reason')}<div><button class="button button-primary" type="submit">Review paper</button></div></form>` : ''}
        ${row.scanStatus === 'clean' && ['uploaded','submitted','approved','returned'].includes(row.status) && (can.manage || can.upload && row.createdBy === data.accountId || can.review && ['submitted','approved'].includes(row.status)) ? `<form class="form form-grid" data-paper-custody-download="${esc(row.id)}">${reason('Access purpose')}<div><button class="button button-secondary" type="submit">Download paper</button></div></form>` : ''}
        ${!['withdrawn','superseded'].includes(row.status) && (can.manage || can.upload && row.createdBy === data.accountId && ['upload_requested','uploaded','submitted','returned'].includes(row.status)) ? `<form class="form form-grid" data-paper-action="withdraw" data-paper-id="${esc(row.id)}" data-revision="${row.revision}">${reason('Withdrawal reason')}<div><button class="button button-secondary" type="submit">Withdraw version</button></div></form>` : ''}
        ${can.release && row.status === 'approved' && data.sitting && data.recipients.length ? `<form class="form form-grid" data-paper-release="${esc(row.id)}" data-revision="${data.sitting.revision}">
          <label class="field"><span>Recipient</span><select class="input" name="staffId">${data.recipients.map((person) => `<option value="${esc(person.id)}">${esc(person.employeeNumber)} ${esc(person.legalName)}</option>`).join('')}</select></label>
          <label class="field"><span>Available from</span><input class="input" type="datetime-local" name="availableAt" value="${local(Date.now())}" required></label><label class="field"><span>Access until</span><input class="input" type="datetime-local" name="expiresAt" value="${local(data.recipients[0].releaseEndAt)}" required></label>
          <label class="field"><span>Copy count</span><input class="input" type="number" name="copies" min="1" max="5000" value="1" required></label><label class="field"><span>Sealed package reference</span><input class="input" name="packageRef" maxlength="200" required></label>${reason('Release reason')}<div><button class="button button-primary" type="submit">Release package</button></div></form>` : ''}</details>`).join('')}
      ${can.upload && data.storageAvailable && !data.papers.some((row) => ['upload_requested','uploaded','submitted'].includes(row.status)) ? `<form class="form form-grid" data-paper-upload><label class="field"><span>Exam paper PDF</span><input class="input" type="file" name="file" accept=".pdf,application/pdf" required></label>${reason('Version reason')}<div><button class="button button-primary" type="submit">Upload new version</button></div></form>` : ''}
      ${data.releases.length ? `<h3>Package history</h3><div class="result-table-wrap"><table class="result-table assessment-grid"><thead><tr><th>Package</th><th>Paper</th><th>Copies</th><th>Status</th><th>Receipt</th></tr></thead><tbody>${data.releases.map((row) => `<tr><td>${esc(row.packageRef)}</td><td>v${data.papers.find((paper) => paper.id === row.paperId)?.version}</td><td>${row.copies}</td><td>${esc(row.status)}</td><td>${esc(row.receiptRef || 'Pending')}</td></tr>`).join('')}</tbody></table></div>${can.release ? data.releases.filter((row) => row.status === 'active').map((row) => `<form class="form form-grid" data-paper-revoke="${esc(row.id)}" data-revision="${row.revision}">${reason(`Revoke ${row.packageRef}`)}<div><button class="button button-secondary" type="submit">Revoke package</button></div></form>`).join('') : ''}` : ''}
      <details data-paper-event-history><summary>Custody history (${data.events.length})</summary><ul>${data.events.map((row) => `<li>${esc(when(row.recordedAt))} - ${esc(row.action)} - ${esc(row.reason)}</li>`).join('')}</ul></details></section>`;
  }
  async function load(state,api) {state.examPaperReleases = await api('GET','/api/exams/paper-releases/me').catch(() => null);}
  function bind(root,state,{api,act}) {
    const refresh = async () => {if (state.examPapers) state.examPapers = await api('GET',`/api/exams/orders/${state.examPapers.order.id}/papers`);await load(state,api);};
    root.querySelector('[data-paper-packages-refresh]')?.addEventListener('click',() => act(refresh));
    const raw = async (path,method,body,type) => {const response = await fetch(path,{method,headers:{Authorization:`Bearer ${state.session.token}`,'Content-Type':type},body});if (!response.ok) throw new Error((await response.json()).error?.message || 'Paper request failed.');return response;};
    const download = async (path,body) => {const response = await raw(path,'POST',JSON.stringify(body),'application/json'),blob = await response.blob(),url = URL.createObjectURL(blob),link = document.createElement('a');link.href = url;link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'exam-paper.pdf';link.click();setTimeout(() => URL.revokeObjectURL(url),1000);};
    root.querySelectorAll('[data-exam-papers-open]').forEach((button) => button.addEventListener('click',() => act(async () => {state.examPapers = await api('GET',`/api/exams/orders/${button.dataset.examPapersOpen}/papers`);state.examPaperOpen = {};})));
    root.querySelector('[data-paper-custody-close]')?.addEventListener('click',() => {state.examPapers = null;act(async () => {});});
    root.querySelectorAll('[data-paper-version]').forEach((panel) => panel.addEventListener('toggle',() => {if (panel.isConnected) {state.examPaperOpen ||= {};state.examPaperOpen[panel.dataset.paperVersion] = panel.open;}}));
    root.querySelectorAll('[data-own-paper-release]').forEach((panel) => panel.addEventListener('toggle',() => {if (panel.isConnected) {state.ownPaperOpen ||= {};state.ownPaperOpen[panel.dataset.ownPaperRelease] = panel.open;}}));
    root.querySelectorAll('[data-paper-release] [name="staffId"]').forEach((select) => select.addEventListener('change',() => {const recipient = state.examPapers.recipients.find((row) => row.id === select.value);if (recipient) select.closest('form').querySelector('[name="expiresAt"]').value = local(recipient.releaseEndAt);}));
    root.querySelector('[data-paper-upload]')?.addEventListener('submit',(event) => {
      event.preventDefault();const form = new FormData(event.currentTarget),file = form.get('file'),note = form.get('reason');
      act(async () => {if (!file.size || file.size > 10485760) throw new Error('Select a PDF up to 10 MB.');const bytes = await file.arrayBuffer(),hash = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),checksum = [...hash].map((byte) => byte.toString(16).padStart(2,'0')).join('');
        const intent = await api('POST',`/api/exams/orders/${state.examPapers.order.id}/papers`,{fileName:file.name,sizeBytes:file.size,checksum,reason:note});
        await raw(intent.upload.url,'PUT',bytes,'application/pdf');state.examPaperOpen ||= {};state.examPaperOpen[intent.paper.id] = true;await refresh();state.notice = 'Paper uploaded; scan pending.';
      });
    });
    root.querySelectorAll('[data-paper-action],[data-paper-release],[data-paper-revoke],[data-paper-acknowledge],[data-paper-custody-download],[data-paper-recipient-download]').forEach((form) => form.addEventListener('submit',(event) => {
      event.preventDefault();const body = Object.fromEntries(new FormData(form));if (form.dataset.revision) body.revision = Number(form.dataset.revision);
      act(async () => {
        if (form.dataset.paperAction) {state.examPapers = await api('POST',`/api/exams/papers/${form.dataset.paperId}/${form.dataset.paperAction}`,body);state.notice = 'Paper custody updated.';}
        if (form.dataset.paperRelease) {body.copies = Number(body.copies);body.availableAt = new Date(body.availableAt).toISOString();body.expiresAt = new Date(body.expiresAt).toISOString();state.examPapers = await api('POST',`/api/exams/papers/${form.dataset.paperRelease}/release`,body);state.notice = 'Paper package released.';}
        if (form.dataset.paperRevoke) {state.examPapers = await api('POST',`/api/exams/paper-releases/${form.dataset.paperRevoke}/revoke`,body);state.notice = 'Paper package revoked.';}
        if (form.dataset.paperAcknowledge) {await api('POST',`/api/exams/paper-releases/${form.dataset.paperAcknowledge}/acknowledge`,body);state.notice = 'Custody receipt acknowledged.';}
        if (form.dataset.paperCustodyDownload) await download(`/api/exams/papers/${form.dataset.paperCustodyDownload}/download`,body);
        if (form.dataset.paperRecipientDownload) await download(`/api/exams/paper-releases/${form.dataset.paperRecipientDownload}/download`,body);
        await refresh();
      });
    }));
  }
  window.registryExamPapersUI = {render,bind,load};
})();
