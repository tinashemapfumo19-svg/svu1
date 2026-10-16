(function () {
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const standards = ['Learning Materials','Online Classes','Assignments','Announcements'];
  const defaults = {file:'Learning Materials',link:'Course Resources',note:'Announcements',class:'Online Classes',assignment:'Assignments'};
  const labels = {file:'File',link:'Link',note:'Note',class:'Online class',assignment:'Assignment'};
  const accept = '.pdf,.png,.jpg,.jpeg,.txt,.docx,.pptx,.xlsx,.zip';
  const time = v => new Date(v).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
  const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  const glyph = name => window.svuShell?.glyphs?.[name] || '';
  const localTime = v => v ? new Date(new Date(v).getTime()-new Date(v).getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
  const host = (period,course) => `<div class="course-workspace" data-course-workspace data-period="${esc(period)}" data-course="${esc(course)}"></div>`;
  function nextLabel(summary={}) {
    return [summary.nextDeadline ? `Assignment due ${time(summary.nextDeadline)}` : '',summary.nextClass ? `Class ${time(summary.nextClass)}` : ''].filter(Boolean).join(' / ');
  }
  function accordion(course,period,meta='',open=false,summary={}) {
    return `<details class="course-expand" data-course-expand ${open ? 'open' : ''}><summary><span class="course-expand-code">${esc(course.code)}</span><span class="course-expand-title">${esc(course.title)}<span class="ui-meta">${esc(meta)}</span><span class="ui-meta" data-course-next>${esc(nextLabel(summary))}</span></span></summary>${host(period,course.courseId)}</details>`;
  }
  async function request(method,path,body,download=false) {
    const token=window.svuSession.get()?.token;
    const response=await fetch(path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined ? undefined : JSON.stringify(body)});
    if(token!==window.svuSession.get()?.token)throw new Error('Your session changed. Reload this course.');
    if(response.status===401){window.svuSession.clear();location.hash='#signin';}
    if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error?.message || `Request failed (${response.status}).`);}
    return download ? response.blob() : (await response.json()).data;
  }
  async function readFile(file) {
    if(!file || !file.size || file.size>10*1024*1024)throw new Error('Choose a file between 1 byte and 10 MB.');
    const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('The file could not be read.'));reader.readAsDataURL(file);});
    return {fileName:file.name,base64};
  }
  // Calendar export (RFC 5545): deadlines get a one-day reminder; classes carry their joining link.
  const icsTime = v => new Date(v).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const icsText = v => String(v ?? '').replace(/[\\,;]/g,c=>`\\${c}`).replace(/\r?\n/g,'\\n');
  function calendar(resources,course) {
    const events=resources.map(r=>{
      const start=r.kind==='assignment' ? new Date(new Date(r.dueAt).getTime()-30*60000) : new Date(r.startsAt);
      const end=r.kind==='assignment' ? new Date(r.dueAt) : new Date(new Date(r.startsAt).getTime()+60*60000);
      return ['BEGIN:VEVENT',`UID:${r.id}@southvalley.course`,`DTSTAMP:${icsTime(new Date())}`,`DTSTART:${icsTime(start)}`,`DTEND:${icsTime(end)}`,
        `SUMMARY:${icsText(`${course.code} ${r.kind==='assignment' ? 'assignment due' : 'online class'}: ${r.title}`)}`,
        ...(r.description ? [`DESCRIPTION:${icsText(r.description.slice(0,1000))}`] : []),...(r.url ? [`URL:${icsText(r.url)}`] : []),
        ...(r.kind==='assignment' ? ['BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${icsText(`${course.code} assignment due tomorrow`)}`,'TRIGGER:-P1D','END:VALARM'] : []),'END:VEVENT'];
    }).flat();
    const blob=new Blob([['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//South Valley University//Courses//EN',...events,'END:VCALENDAR'].join('\r\n')],{type:'text/calendar'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${course.code}-${resources.length===1 ? resources[0].kind : 'calendar'}.ics`.replace(/\s+/g,'-');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const downloadButton = (r,file,submission='',review='') => `<button class="button button-secondary" type="button" data-course-download="${esc(r.id)}" data-submission="${esc(submission)}" data-review="${esc(review)}" data-filename="${esc(file.fileName)}">${glyph('download')} ${esc(file.fileName)} (${Math.ceil(file.sizeBytes/1024)} KB)</button>`;
  function feedbackView(review,r) {
    if (!review) return '';
    return `<div class="course-feedback"><strong>${review.released ? 'Released feedback' : 'Draft feedback'}</strong>${review.mark !== null ? `<p>Coursework mark: ${esc(review.mark)} / ${esc(review.maxMark)} (${Math.round(review.mark/review.maxMark*10000)/100}%)</p>` : ''}${review.feedback ? `<p class="course-resource-description">${esc(review.feedback)}</p>` : ''}<p class="ui-meta">${esc(time(review.createdAt))} / Review ${review.revision}</p>${review.file ? downloadButton(r,review.file,'',review.id) : ''}</div>`;
  }
  const aiPercent = v => `${Math.round(v*100)/100}%`;
  function aiLine(check) {
    if (!check) return '';
    if (check.status!=='completed') return `<span class="ui-meta" data-ai-score>AI similarity check unavailable when submitted</span>`;
    return `<span class="ui-meta" data-ai-score>AI similarity ${aiPercent(check.aiScore)} (allowable ${aiPercent(check.threshold)})${check.aboveThreshold ? ' / Above threshold, submitted after warning' : ''}</span>`;
  }
  function aiCell(check) {
    if (!check) return '<span class="ui-meta">Not checked</span>';
    if (check.status!=='completed') return '<span class="ui-meta">Unavailable</span>';
    return `<span class="ui-badge ${check.aboveThreshold ? 'ui-badge-amber' : 'ui-badge-green'}" data-ai-badge>${aiPercent(check.aiScore)}</span><br><span class="ui-meta">${check.aboveThreshold ? `Above ${aiPercent(check.threshold)}` : `Within ${aiPercent(check.threshold)}`}</span>`;
  }
  // Receipt card: an animated check, the time and attempt, a short file fingerprint, the AI gauge when a score
  // exists, and a downloadable receipt the student can keep as proof.
  const checkMark = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-6.5"/></svg>';
  function receipt(upload,resource) {
    const check=upload.aiCheck,fingerprint=upload.file.checksum ? upload.file.checksum.slice(0,12) : '';
    return `<div class="course-receipt${Date.now()-new Date(upload.submittedAt).getTime()<60000 ? ' is-new' : ''}"><div class="receipt-head"><span class="receipt-check">${checkMark}</span><div class="receipt-title"><strong>Submission received${upload.late ? ' - Late' : ''}</strong><span class="ui-meta">${esc(time(upload.submittedAt))} / Attempt ${upload.attempt}</span></div>${check?.status==='completed' ? window.svuUI.gauge(check.aiScore,check.threshold) : ''}</div>
      <span>${esc(upload.file.fileName)}</span><span class="ui-meta">Receipt ${esc(upload.id)}${fingerprint ? ` · Fingerprint ${esc(fingerprint)}` : ''}</span>${aiLine(upload.aiCheck)}
      <div class="course-resource-actions">${downloadButton(resource,upload.file,upload.id)}<button class="button button-secondary" type="button" data-course-receipt="${esc(upload.id)}">${glyph('download')} Download receipt</button></div>${feedbackView(upload.review,resource)}</div>`;
  }
  function receiptFile(upload,resource,course) {
    const rows=[['Course',`${course.code} ${course.title}`],['Assignment',resource.title],['Attempt',upload.attempt],['Received',new Date(upload.submittedAt).toISOString().replace('T',' ').slice(0,16)+' UTC'],['File',upload.file.fileName],['Size',`${upload.file.sizeBytes} bytes`],['SHA-256 fingerprint',upload.file.checksum || ''],['Receipt',upload.id],['Late',upload.late ? 'Yes' : 'No'],...(upload.aiCheck?.status==='completed' ? [['AI similarity',`${upload.aiCheck.aiScore}% (allowable ${upload.aiCheck.threshold}%)`]] : [])];
    const html=`<!doctype html><meta charset="utf-8"><title>Submission receipt ${esc(upload.id)}</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:640px;margin:40px auto;color:#0F172A}h1{font-size:20px}td{padding:6px 12px;border-bottom:1px solid #E5E7EB;vertical-align:top}td:first-child{color:#64748B;white-space:nowrap}code{word-break:break-all}</style><h1>South Valley University: submission receipt</h1><table>${rows.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${k.includes('fingerprint') ? `<code>${esc(v)}</code>` : esc(v)}</td></tr>`).join('')}</table><p>Keep this receipt as proof of submission. The fingerprint identifies the exact file received.</p>`;
    const url=URL.createObjectURL(new Blob([html],{type:'text/html'})),a=document.createElement('a');a.href=url;a.download=`receipt-${upload.id}.html`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function resourceView(r,data) {
    const uploads=data.submissions.filter(row=>row.resourceId===r.id),expired=r.kind==='assignment' && Date.now()>new Date(r.dueAt).getTime();
    const roster=data.roster || [],submitted=new Set(uploads.map(u=>u.studentId)),missing=roster.filter(s=>!submitted.has(s.studentId));
    return `<article class="course-resource" data-resource="${esc(r.id)}"><header class="course-resource-head"><div><h4>${esc(r.title)}</h4><div class="course-resource-tags"><span>${esc(labels[r.kind])}</span>${r.pinned ? '<span>Pinned</span>' : ''}${data.canManage ? `<span>${esc(r.status)}</span>` : ''}</div></div>${data.canManage ? `<button class="button button-secondary" type="button" data-course-edit="${esc(r.id)}">${glyph('edit')} Edit</button>` : ''}</header>
      ${r.description ? `<p class="course-resource-description">${esc(r.description)}</p>` : ''}
      ${r.startsAt ? `<p class="course-date">${esc(time(r.startsAt))} <span class="ui-meta">${esc(zone())}</span></p>` : ''}
      ${r.dueAt ? `<p class="course-date">Due ${esc(time(r.dueAt))} <span class="ui-meta">${esc(zone())}</span>${expired ? r.allowLate ? ' / Late submissions accepted' : ' / Closed' : ''}</p>` : ''}
      <div class="course-resource-actions">${r.file ? downloadButton(r,r.file) : ''}${(r.kind==='assignment' && r.dueAt || r.kind==='class' && r.startsAt) && new Date(r.dueAt || r.startsAt)>new Date() ? `<button class="button button-secondary" type="button" data-course-ics="${esc(r.id)}">${glyph('calendar')} Add to calendar</button>` : ''}${r.url ? `<a class="button ${r.kind==='class' ? 'button-primary' : 'button-secondary'}" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${glyph('external')} ${r.kind==='class' ? 'Join class' : 'Open link'}</a>` : ''}</div>
      ${r.kind==='assignment' && !data.canManage ? `${uploads[0] ? receipt(uploads[0],r) : '<p class="ui-meta">Not submitted</p>'}${!expired || r.allowLate ? `<form class="course-submission" data-course-submit="${esc(r.id)}"><label class="field"><span>${uploads.length ? 'Replacement file' : 'Assignment file'}</span><input type="file" name="file" accept="${accept}" required></label>${data.aiCheck?.enabled ? `<p class="ui-meta">PDF, DOCX and TXT files are checked for AI similarity before they are submitted. The allowable score for this assignment is ${aiPercent(r.aiThreshold ?? data.aiCheck.threshold)}.</p>` : ''}<div data-ai-result hidden></div><button class="button button-primary" type="submit">${glyph('upload')} ${uploads.length ? 'Replace submission' : 'Upload assignment'}</button></form>` : ''}${uploads.length>1 ? `<details class="course-history"><summary>Previous submissions (${uploads.length-1})</summary>${uploads.slice(1).map(u=>receipt(u,r)).join('')}</details>` : ''}` : ''}
      ${r.kind==='assignment' && data.canManage ? `<div class="course-assignment-progress">${window.svuUI.ring(roster.filter(s=>submitted.has(s.studentId)).length,roster.length)}<div class="course-assignment-summary"><div class="course-assignment-counts"><span>Enrolled: ${roster.length}</span><span>Submitted: ${roster.filter(s=>submitted.has(s.studentId)).length}</span><span>Missing: ${missing.length}</span></div>
        ${missing.length ? `<span class="ui-avatars" aria-label="Not yet submitted">${missing.slice(0,6).map(s=>`<span class="ui-avatar" title="${esc(s.studentName)}">${esc(window.svuUI.initials(s.studentName))}</span>`).join('')}${missing.length>6 ? `<span class="ui-avatar is-more">+${missing.length-6}</span>` : ''}</span>` : ''}</div>
        ${missing.length && r.status==='published' ? `<button class="button button-secondary" type="button" data-course-remind="${esc(r.id)}">Remind ${missing.length} ${missing.length===1 ? 'student' : 'students'} who have not submitted</button>` : ''}</div><details class="course-history"><summary>Not submitted (${missing.length})</summary>${missing.map(s=>`<p>${esc(s.studentNumber)} - ${esc(s.studentName)}</p>`).join('') || '<p class="ui-meta">Everyone has submitted.</p>'}</details><details class="course-history"><summary>Submissions (${new Set(uploads.map(u=>u.studentNumber)).size} students)</summary>${uploads.length ? `<div class="result-table-wrap"><table class="result-table"><thead><tr><th>Student</th><th>Received</th><th>Attempt</th><th>File</th>${data.aiCheck?.enabled || uploads.some(u=>u.aiCheck) ? '<th>AI similarity</th>' : ''}<th>Review</th></tr></thead><tbody>${uploads.map(u=>`<tr><td>${esc(u.studentName)}<br>${esc(u.studentNumber)}</td><td>${esc(time(u.submittedAt))}${u.late ? ' / Late' : ''}</td><td>${u.attempt}</td><td>${downloadButton(r,u.file,u.id)}</td>${data.aiCheck?.enabled || uploads.some(x=>x.aiCheck) ? `<td>${aiCell(u.aiCheck)}</td>` : ''}<td>${u.review ? `${u.review.mark === null ? 'Feedback' : `${esc(u.review.mark)} / ${esc(u.review.maxMark)}`}<br>${u.review.released ? 'Released' : 'Draft'}` : 'Unmarked'}<button class="button button-secondary" type="button" data-course-mark="${esc(u.id)}">Mark / feedback</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="ui-meta">No submissions yet.</p>'}</details>` : ''}</article>`;
  }
  function editor(data,item={}) {
    const sections=[...new Set([...standards,'Course Resources',...data.resources.map(r=>r.section)])];
    return `<form class="course-editor" data-course-editor data-id="${esc(item.id || '')}"><header class="course-editor-head"><h3>${item.id ? 'Edit resource' : 'Add resource'}</h3><button class="button button-secondary" type="button" data-course-cancel>Cancel</button></header><input type="hidden" name="revision" value="${item.revision || 0}"><div class="course-editor-grid">
      <label class="field"><span>Type</span><select class="input" name="kind" ${item.id ? 'disabled' : ''}>${Object.entries(labels).map(([key,label])=>`<option value="${key}" ${(item.kind || 'file')===key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="field"><span>Title</span><input class="input" name="title" maxlength="200" value="${esc(item.title)}" required></label>
      <label class="field"><span>Section</span><input class="input" name="section" list="course-sections-${data.uid}" maxlength="100" value="${esc(item.section || 'Learning Materials')}" required><datalist id="course-sections-${data.uid}">${sections.map(s=>`<option value="${esc(s)}"></option>`).join('')}</datalist></label>
      <label class="field"><span>Topic / Instructions</span><textarea class="input" name="description" rows="3" maxlength="12000">${esc(item.description)}</textarea></label>
      <label class="field" data-kind-field="link class"><span>Link</span><input class="input" name="url" type="url" maxlength="2000" value="${esc(item.url)}"></label>
      <label class="field" data-kind-field="class"><span>Class time (${esc(zone())})</span><input class="input" name="startsAt" type="datetime-local" value="${localTime(item.startsAt)}"></label>
      <label class="field" data-kind-field="assignment"><span>Deadline (${esc(zone())})</span><input class="input" name="dueAt" type="datetime-local" value="${localTime(item.dueAt)}"></label>
      ${data.aiCheck?.enabled ? `<label class="field" data-kind-field="assignment"><span>Allowable AI similarity (%)</span><input class="input" name="aiThreshold" type="number" min="0" max="100" step="0.01" value="${item.aiThreshold ?? ''}" placeholder="Default ${data.aiCheck.threshold}"></label>` : ''}
      <label class="field" data-kind-field="file assignment"><span>${item.file ? `Replace ${esc(item.file.fileName)}` : 'File'}</span><input name="file" type="file" accept="${accept}"></label>
      <label class="field"><span>Section order</span><input class="input" type="number" name="sectionPosition" min="0" max="9999" value="${item.sectionPosition || 0}" required></label>
      <label class="field"><span>Item order</span><input class="input" type="number" name="position" min="0" max="9999" value="${item.position || 0}" required></label>
      <label class="field"><span>Status</span><select class="input" name="status">${['draft','published','archived'].map(s=>`<option ${item.status===s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <div class="course-editor-checks"><label><input name="pinned" type="checkbox" ${item.pinned ? 'checked' : ''}> Pin resource</label><label data-kind-field="assignment"><input name="allowLate" type="checkbox" ${item.allowLate ? 'checked' : ''}> Accept late submissions</label></div></div><button class="button button-primary" type="submit">${glyph('save')} Save resource</button></form>`;
  }
  function workspace(data) {
    const visible=data.resources.filter(r=>r.status!=='archived');
    const custom=[...new Set(visible.map(r=>r.section))].filter(s=>!standards.includes(s)).sort((a,b)=>Math.min(...visible.filter(r=>r.section===a).map(r=>r.sectionPosition))-Math.min(...visible.filter(r=>r.section===b).map(r=>r.sectionPosition)) || a.localeCompare(b));
    const upcomingDated=visible.filter(r=>r.status==='published' && (r.kind==='assignment' && r.dueAt || r.kind==='class' && r.startsAt) && new Date(r.dueAt || r.startsAt)>new Date());
    return `<section class="course-attendance" data-course-attendance data-manage="${data.canManage ? '1' : ''}"></section><section class="course-evaluation" data-course-evaluation data-manage="${data.canManage ? '1' : ''}"></section>${upcomingDated.length>1 ? `<div class="course-manager-bar"><button class="button button-secondary" type="button" data-course-ics-all>${glyph('calendar')} Add all ${upcomingDated.length} upcoming deadlines and classes to calendar</button></div>` : ''}${data.canManage ? `<div class="course-manager-bar"><button class="button button-primary" type="button" data-course-add>${glyph('plus')} Add resource</button></div><div data-course-editor-slot></div><div data-course-review-slot></div>` : ''}${[...standards,...custom].map((s,index)=>{
      const scheduleOrder=(a,b)=>{
        if(!['assignment','class'].includes(a.kind) || a.kind!==b.kind)return 0;
        const dateA=new Date(a.dueAt || a.startsAt).getTime(),dateB=new Date(b.dueAt || b.startsAt).getTime();
        const pastA=dateA<Date.now(),pastB=dateB<Date.now();
        if(pastA!==pastB)return Number(pastA)-Number(pastB);
        return a.kind==='class' && pastA ? dateB-dateA : dateA-dateB;
      };
      const rows=visible.filter(r=>r.section===s).sort((a,b)=>Number(b.pinned)-Number(a.pinned) || scheduleOrder(a,b) || a.position-b.position || a.title.localeCompare(b.title));
      return `<section class="course-content-section"><header><h3>${index+1}. ${esc(s)}</h3><span class="ui-meta">${rows.length} ${rows.length===1 ? 'item' : 'items'}</span></header>${rows.map(r=>resourceView(r,data)).join('') || '<p class="ui-meta course-section-empty">Nothing published yet.</p>'}</section>`;
    }).join('')}${data.canManage && data.resources.some(r=>r.status==='archived') ? `<details class="course-history"><summary>Archived resources</summary>${data.resources.filter(r=>r.status==='archived').map(r=>resourceView(r,data)).join('')}</details>` : ''}`;
  }
  function bind(root) {
    root.querySelectorAll('[data-course-workspace]').forEach(container=>{
      if(container.dataset.bound)return;container.dataset.bound='true';
      const base=`/api/course-workspaces/${encodeURIComponent(container.dataset.period)}/${encodeURIComponent(container.dataset.course)}`;
      const enclosing=container.closest('[data-course-expand]'),token=window.svuSession.get()?.token,uid=`cw-${Math.random().toString(36).slice(2)}`;
      let data,loading=false,writing=false;
      const active=()=>container.isConnected && token===window.svuSession.get()?.token;
      container.addEventListener('click',async event=>{
        const b=event.target.closest('[data-course-download]');if(!b || b.disabled)return;b.disabled=true;
        try{const blob=await request('GET',`${base}/resources/${b.dataset.courseDownload}/download${b.dataset.review ? `?review=${encodeURIComponent(b.dataset.review)}` : b.dataset.submission ? `?submission=${encodeURIComponent(b.dataset.submission)}` : ''}`,undefined,true);if(!active())return;
          const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=b.dataset.filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }catch(error){if(active())notice(error.message,true);}finally{b.disabled=false;}
      });
      function notice(message,error=false){const box=container.querySelector('[data-course-notice]');if(box){box.hidden=false;box.className=`notice ${error ? 'notice-error' : ''}`;box.textContent=message;box.setAttribute('role',error ? 'alert' : 'status');}}
      async function load(){
        if(loading || writing)return;loading=true;container.innerHTML='<p class="ui-meta" role="status">Loading course...</p>';
        try{const next=await request('GET',base);if(!active())return;data={...next,uid};paint();}
        catch(error){if(active()){container.innerHTML='<div class="notice notice-error" role="alert"></div><button class="button button-secondary" type="button">Retry</button>';container.firstElementChild.textContent=error.message;container.querySelector('button').onclick=load;}}
        finally{loading=false;}
      }
      async function write(work,message){
        if(writing)return;writing=true;
        const controls=Array.from(container.querySelectorAll('button,input,select,textarea')).map(c=>[c,c.disabled]);controls.forEach(([c])=>c.disabled=true);container.setAttribute('aria-busy','true');
        try{await work();if(!active())return;const next=await request('GET',base);if(!active())return;data={...next,uid};paint();notice(typeof message==='function' ? message() : message);}
        catch(error){if(active())notice(error.message,true);}
        finally{writing=false;container.removeAttribute('aria-busy');controls.forEach(([c,disabled])=>c.disabled=disabled);}
      }
      function openEditor(item={}){
        const slot=container.querySelector('[data-course-editor-slot]');slot.innerHTML=editor(data,item);
        const form=slot.querySelector('form'),kind=form.elements.kind;
        const update=()=>form.querySelectorAll('[data-kind-field]').forEach(el=>{const shown=el.dataset.kindField.split(' ').includes(kind.value);el.hidden=!shown;el.querySelectorAll('input').forEach(input=>{input.disabled=!shown;input.required=shown && (['url','startsAt','dueAt'].includes(input.name) || input.name==='file' && kind.value==='file' && !item.file);});});
        kind.addEventListener('change',()=>{form.elements.section.value=defaults[kind.value];update();});update();form.querySelector('[data-course-cancel]').onclick=()=>slot.replaceChildren();
        form.addEventListener('submit',event=>{
          event.preventDefault();const e=form.elements;
          const values={kind:kind.value,title:e.title.value,section:e.section.value,description:e.description.value,url:e.url.disabled ? null : e.url.value,
            startsAt:e.startsAt.disabled || !e.startsAt.value ? null : new Date(e.startsAt.value).toISOString(),dueAt:e.dueAt.disabled || !e.dueAt.value ? null : new Date(e.dueAt.value).toISOString(),allowLate:e.allowLate.checked,pinned:e.pinned.checked,position:Number(e.position.value),sectionPosition:Number(e.sectionPosition.value),status:e.status.value,revision:Number(e.revision.value),
            aiThreshold:!e.aiThreshold ? item.aiThreshold ?? null : e.aiThreshold.disabled || e.aiThreshold.value==='' ? null : Number(e.aiThreshold.value)};
          const file=e.file.disabled ? null : e.file.files[0];
          write(async()=>{if(file)values.file=await readFile(file);await request('POST',`${base}/resources${form.dataset.id ? `/${form.dataset.id}` : ''}`,values);},'Resource saved.');
        });form.elements.title.focus();
      }
      function openReview(upload) {
        const review=upload.review,slot=container.querySelector('[data-course-review-slot]');
        slot.innerHTML=`<form class="course-editor" data-course-review data-submission="${esc(upload.id)}" data-resource="${esc(upload.resourceId)}"><header class="course-editor-head"><h3>${esc(upload.studentName)} / Attempt ${upload.attempt}</h3><button class="button button-secondary" type="button" data-review-cancel>Cancel</button></header><div class="course-editor-grid"><label class="field"><span>Coursework mark</span><input class="input" name="mark" type="number" min="0" step="0.01" value="${esc(review?.mark)}"></label><label class="field"><span>Maximum mark</span><input class="input" name="maxMark" type="number" min="0.01" max="10000" step="0.01" value="${review?.maxMark || 100}" required></label><label class="field"><span>Feedback</span><textarea class="input" name="feedback" maxlength="12000" rows="4">${esc(review?.feedback)}</textarea></label><label class="field"><span>${review?.file ? `Replace ${esc(review.file.fileName)}` : 'Marked file'}</span><input type="file" name="file" accept="${accept}"></label><label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label><label><input name="release" type="checkbox"> Release to student</label></div>${review ? feedbackView(review,data.resources.find(r=>r.id===upload.resourceId)) : ''}<button class="button button-primary" type="submit">Save review</button></form>`;
        const form=slot.querySelector('form');form.querySelector('[data-review-cancel]').onclick=()=>slot.replaceChildren();
        form.addEventListener('submit',event=>{
          event.preventDefault();const e=form.elements,file=e.file.files[0];
          const value={submissionId:upload.id,revision:review?.revision || 0,mark:e.mark.value === '' ? null : Number(e.mark.value),maxMark:Number(e.maxMark.value),feedback:e.feedback.value,release:e.release.checked,reason:e.reason.value};
          write(async()=>{if(file)value.file=await readFile(file);await request('POST',`${base}/resources/${upload.resourceId}/review`,value);},value.release ? 'Feedback released to the student.' : 'Review saved privately.');
        });form.elements.mark.focus();slot.scrollIntoView({behavior:'smooth',block:'start'});
      }
      function paint(){
        const published=data.resources.filter(r=>r.status==='published');
        const upcoming=kind=>published.filter(r=>r.kind===kind && new Date(r.dueAt || r.startsAt)>new Date() && (kind!=='assignment' || !data.submissions.some(u=>u.resourceId===r.id))).sort((a,b)=>new Date(a.dueAt || a.startsAt)-new Date(b.dueAt || b.startsAt))[0];
        const next=enclosing?.querySelector('[data-course-next]');if(next)next.textContent=nextLabel({nextDeadline:upcoming('assignment')?.dueAt,nextClass:upcoming('class')?.startsAt});
        container.innerHTML=`<div data-course-notice hidden></div><fieldset class="course-workspace-controls">${workspace(data)}</fieldset>`;
        container.querySelectorAll('.result-table').forEach(table=>{
          const headings=Array.from(table.querySelectorAll('thead th'),cell=>cell.textContent);
          table.querySelectorAll('tbody tr').forEach(row=>Array.from(row.cells).forEach((cell,index)=>cell.dataset.label=headings[index]));
        });
        container.querySelector('[data-course-add]')?.addEventListener('click',()=>openEditor());
        container.querySelectorAll('[data-course-edit]').forEach(b=>b.onclick=()=>openEditor(data.resources.find(r=>r.id===b.dataset.courseEdit)));
        container.querySelectorAll('[data-course-mark]').forEach(b=>b.onclick=()=>openReview(data.submissions.find(u=>u.id===b.dataset.courseMark)));
        container.querySelectorAll('[data-course-receipt]').forEach(b=>b.onclick=()=>{const upload=data.submissions.find(u=>u.id===b.dataset.courseReceipt);if(upload)receiptFile(upload,data.resources.find(r=>r.id===upload.resourceId),data.course);});
        container.querySelectorAll('[data-course-ics]').forEach(b=>b.onclick=()=>calendar([data.resources.find(r=>r.id===b.dataset.courseIcs)],data.course));
        container.querySelector('[data-course-ics-all]')?.addEventListener('click',()=>calendar(data.resources.filter(r=>r.status==='published' && (r.kind==='assignment' && r.dueAt || r.kind==='class' && r.startsAt) && new Date(r.dueAt || r.startsAt)>new Date()),data.course));
        container.querySelectorAll('[data-course-remind]').forEach(b=>b.onclick=()=>{let result;write(async()=>{result=await request('POST',`${base}/resources/${b.dataset.courseRemind}/remind-missing`);},
          ()=>result.sent ? `Reminder sent to ${result.sent} ${result.sent===1 ? 'student' : 'students'}.${result.alreadyRemindedToday ? ` ${result.alreadyRemindedToday} already reminded today.` : ''}` : 'Everyone who has not submitted was already reminded today.');});
        const discussions=document.createElement('section');discussions.className='course-content-section course-discussions';container.append(discussions);window.bindCourseDiscussions(discussions,base);
        container.querySelectorAll('[data-course-submit]').forEach(form=>{
          const id=form.dataset.courseSubmit,result=form.querySelector('[data-ai-result]');
          const main=form.querySelector('button[type=submit]');
          const clear=()=>{result.hidden=true;result.replaceChildren();main.hidden=false;};
          form.elements.file.addEventListener('change',clear);
          const submit=(payload,check,acknowledge=false)=>write(async()=>request('POST',`${base}/resources/${id}/submit`,{file:payload,...(check?.id ? {aiCheckId:check.id} : {}),...(acknowledge ? {acknowledgeAiWarning:true} : {})}),
            check?.status==='completed' ? `Assignment received. AI similarity ${aiPercent(check.aiScore)} (allowable ${aiPercent(check.threshold)}). Your receipt is shown below.`
              : check?.status==='unavailable' ? 'Assignment received. The AI similarity check was unavailable, so no score was recorded. Your receipt is shown below.'
              : 'Assignment received. Your receipt is shown below.');
          form.addEventListener('submit',async event=>{
            event.preventDefault();clear();
            if(!data.aiCheck?.enabled){const file=form.elements.file.files[0];write(async()=>request('POST',`${base}/resources/${id}/submit`,{file:await readFile(file)}),'Assignment received. Your receipt is shown below.');return;}
            if(writing)return;
            let payload,check;
            const controls=Array.from(form.querySelectorAll('button,input')).map(c=>[c,c.disabled]);controls.forEach(([c])=>c.disabled=true);form.setAttribute('aria-busy','true');
            try{payload=await readFile(form.elements.file.files[0]);check=await request('POST',`${base}/resources/${id}/ai-check`,{file:payload});}
            catch(error){if(active())notice(error.message,true);return;}
            finally{form.removeAttribute('aria-busy');controls.forEach(([c,disabled])=>c.disabled=disabled);}
            if(!active())return;
            if(check.status!=='completed' || !check.aboveThreshold){submit(payload,check);return;}
            // Above the allowable score: the student decides. The score is an estimate and is shown to the lecturer.
            result.hidden=false;main.hidden=true;
            result.innerHTML=`<div class="ui-alert ui-alert-warning ai-warning" role="alert">${window.svuUI.gauge(check.aiScore,check.threshold)}<div><strong>AI similarity ${esc(aiPercent(check.aiScore))}: above the allowable ${esc(aiPercent(check.threshold))}</strong><span>AI similarity scores are estimates and can change between checks. You can choose a different file, or submit this one anyway. Your lecturer will see the score and that you were warned.</span></div></div><div class="ui-actions"><button class="button button-primary" type="button" data-ai-submit-anyway>Submit anyway</button><button class="button button-secondary" type="button" data-ai-choose>Choose a different file</button></div>`;
            result.querySelector('[data-ai-submit-anyway]').onclick=()=>submit(payload,check,true);
            result.querySelector('[data-ai-choose]').onclick=()=>{clear();form.elements.file.value='';form.elements.file.focus();};
            result.querySelector('[data-ai-submit-anyway]').focus();
          });
        });
      }
      enclosing?.addEventListener('toggle',()=>{if(!enclosing.open)return;root.querySelectorAll('[data-course-expand]').forEach(other=>{if(other!==enclosing)other.open=false;});load();});
      if(!enclosing || enclosing.open)load();
    });
  }
  window.courseWorkspaceUI={host,accordion,bind};
})();
