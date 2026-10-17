(function(){
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const context=r=>[r.intake,r.studyYear?`Study year ${r.studyYear}`:null,r.term?`Term ${r.term}`:null,r.academicYear||'Academic year not recorded'].filter(Boolean).map(esc).join(' · ');
 function courses(data){
  const rows=data?.courses||[];if(!rows.length)return '';
  return `<section class="ui-card legacy-academic-courses" data-legacy-courses><h3>Courses from the previous system</h3>
   <p class="ui-meta">Historical course membership recorded through assignments and examinations.</p>
   <ul class="ui-rows">${rows.map(r=>`<li class="ui-row"><div><strong>${esc(r.code)} — ${esc(r.title)}</strong>
   <p class="ui-meta">${context(r)}</p><p>${r.lecturers.length?`Lecturers: ${r.lecturers.map(s=>esc(s.name)).join(', ')}`:'Lecturer not recorded on this evidence'}</p>
   <span class="ui-meta">${esc(r.evidenceCount)} source records · ${r.evidenceKinds.map(v=>esc(v.replaceAll('_',' '))).join(', ')}${r.needsReconciliation?' · Requires reconciliation':''}</span></div></li>`).join('')}</ul></section>`;
 }
 function results(data){
  const rows=data?.results||[];if(!rows.length)return '';
  return `<section class="ui-card legacy-academic-results" data-legacy-results><h3>Results from the previous system</h3>
   <p class="ui-meta">Marks, grades and decisions as recorded in the legacy system.</p>
   <ul class="ui-rows">${rows.map(r=>{const d=r.details;return `<li class="ui-row"><div><strong>${esc(r.code||'Award')} ${esc(r.title||'')} · ${esc(r.kind.replaceAll('_',' '))}</strong>
    <p class="ui-meta">${context(r)}${d.assignment_no?` · Assignment ${esc(d.assignment_no)}`:''}</p>
    <p>${[['Mark',d.exam_mark??d.mark_obtained],['Grade',d.grade??d.progressive_grade??d.degree_grade],['Points',d.points??d.gpa_points??d.degree_points],['Decision',d.decision??d.decession??d.semester_decision],['Classification',d.degree_class]].filter(([,v])=>v!=null&&v!=='').map(([k,v])=>`${k}: ${esc(v)}`).join(' · ')}</p>
    <span class="ui-meta">${r.published?'Recorded published':'Not recorded published'} · ${esc(r.sourceTable)}:${esc(r.sourceRow)}${r.lecturerName?` · ${esc(r.lecturerName)}`:''}${r.issues.length?' · Requires reconciliation':''}</span></div></li>`;}).join('')}</ul></section>`;
 }
 function teaching(rows=[],lists={}){
  if(!rows.length)return '';
  return `<details class="legacy-academic-teaching"><summary>Historical teaching and classes (${rows.length})</summary>
   <ul class="ui-rows">${rows.map(r=>{const key=`${r.contextId}:${r.staffId}`,list=lists[key];return `<li class="ui-row"><div><strong>${esc(r.code)} — ${esc(r.title)}</strong><p>${esc(r.staffName)} · ${esc(r.programmeCode)}</p><p class="ui-meta">${context(r)} · ${r.students} students</p>
   ${r.students?`<button class="button button-secondary" data-legacy-class="${esc(key)}" type="button">Historical class list</button>`:''}
   ${list?`<ul>${list.students.map(s=>`<li>${esc(s.studentNumber)} — ${esc(s.legalName)}</li>`).join('')}</ul>`:''}</div></li>`;}).join('')}</ul></details>`;
 }
 window.legacyAcademicUI={courses,results,teaching};
})();
