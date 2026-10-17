(function () {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const base = '/api/master-data';
  const tabs = { organization: 'Faculties & departments', programmes: 'Programmes & curricula', courses: 'Courses', periods: 'Academic periods', intakes: 'Intakes', grading: 'Grading', gpa: 'GPA rules' };
  const paths = { organization: 'organization-units', programmes: 'programmes', courses: 'courses', periods: 'academic-periods', intakes: 'intakes', grading: 'grading-schemes', gpa: 'gpa-rule-sets' };
  const windows = ['application','registration','teaching','assessment','results_publication','archive'];
  const title = value => String(value || '').replaceAll('_', ' ');
  const optionLabel = row => [...new Set([row.code || row.label, row.name || row.title].filter(Boolean))].join(' - ') || row.id;
  const options = (rows, selected, empty = 'Select') => `<option value="">${esc(empty)}</option>${rows.map(row => `<option value="${esc(row.id)}" ${row.id === selected ? 'selected' : ''}>${esc(optionLabel(row))}</option>`).join('')}`;
  const input = (label, name, value = '', type = 'text', attrs = 'required') => `<label class="field"><span>${esc(label)}</span><input class="input" name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
  const select = (label, name, choices, value = '', required = true) => `<label class="field"><span>${esc(label)}</span><select class="input" name="${name}" ${required ? 'required' : ''}>${Array.isArray(choices) ? options(choices, value, choices.length ? (required ? `Select ${label.toLowerCase()}` : 'None') : `No ${label.toLowerCase()} options available`) : Object.entries(choices).map(([key,label]) => `<option value="${esc(key)}" ${key === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`;
  const reason = () => input('Reason', 'reason', '', 'text', 'required maxlength="2000"');
  const form = (action, fields, label = 'Save') => `<form class="form form-grid" data-academic-form="${action}">${fields}<div><button class="button button-primary" type="submit">${label}</button></div></form>`;
  const table = (headers, rows) => `<div class="academic-table"><table><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${headers.length}">No records.</td></tr>`}</tbody></table></div>`;
  const row = cells => `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
  const action = (label, kind, id) => `<button type="button" class="button button-secondary" data-academic-action="${kind}" data-id="${esc(id)}">${esc(label)}</button>`;
  function model(state) { return state.academicSetup ||= { tab: 'organization', selected: null, data: {}, versions: [], curriculum: null, history: [] }; }
  async function load(state, api) {
    const m = model(state);
    for (const [key,path] of Object.entries(paths)) m.data[key] = await api('GET', `${base}/${path}`);
    if (m.selected && !m.data[m.tab].some(item => item.id === m.selected)) m.selected = null;
    if (m.selected) await detail(state,api,m.selected);
  }
  async function detail(state, api, id) {
    const m = model(state); m.selected = id; m.copy = null; m.history = []; m.versions = []; m.curriculum = null; m.preview = null;
    if (m.tab === 'organization') m.history = await api('GET', `${base}/organization-units/${encodeURIComponent(id)}/history`);
    if (m.tab === 'programmes') {
      m.versions = await api('GET', `${base}/programmes/${encodeURIComponent(id)}/versions`);
      if (!m.versions.some(v => v.id === m.versionId)) m.versionId = m.versions[0]?.id;
      if (m.versionId) m.curriculum = await api('GET', `${base}/programme-versions/${encodeURIComponent(m.versionId)}/curriculum`);
    }
  }
  function lifecycle(path, choices) {
    return form(`transition:${path}`, select('New status','toStatus',choices) + reason(), 'Change status');
  }
  function organization(m, item) {
    const faculties = m.data.organization.filter(r => r.unitType === 'faculty' && r.status === 'active');
    return `${!item || item.status === 'active' ? form(item ? 'edit' : 'create', `${!item ? input('Code','code') + select('Unit type','unitType',{faculty:'Faculty',department:'Department'}) : ''}${input('Name','name',item?.name)}${select('Faculty','parentId',faculties,item?.parentId,false)}${input('Effective from','effectiveFrom','','date')}${reason()}`, item ? 'Save changes' : 'Create unit') : ''}
      ${item ? form(item.status === 'active' ? 'deactivate' : 'reactivate', input('Effective from','effectiveFrom','','date') + reason(),item.status === 'active' ? 'Deactivate unit' : 'Reactivate unit') + '<h3>History</h3>' + table(['Name','Status','Effective from','Effective to','Reason'],m.history.map(h => row([esc(h.name),esc(h.status),esc(h.effectiveFrom),esc(h.effectiveTo || 'Current'),esc(h.reason)]))) : ''}`;
  }
  function programmes(m,item) {
    if (!item) return form('create',input('Code','code')+input('Name','name')+select('Department','departmentId',m.data.organization.filter(r => r.unitType === 'department' && r.status === 'active'))+reason(),'Create programme');
    const v = m.versions.find(r => r.id === m.versionId), c = m.curriculum;
    return `<p>${esc(item.code)} - ${esc(item.name)} (${esc(item.status)})</p>${!['inactive','retired'].includes(item.status) ? form('edit',input('Name','name',item.name)+select('Department','departmentId',m.data.organization.filter(r => r.unitType === 'department' && r.status === 'active'),item.departmentId)+reason(),'Save programme') : ''}<h3>Versions</h3>
      ${form('version',input('Version label','versionLabel')+input('Effective from','effectiveFrom','','date','')+reason(),'Create draft version')}
      <div class="academic-actions">${m.versions.map(version => action(`${version.versionLabel} - ${version.status}`,'version',version.id)).join('')}</div>
      ${v ? `<h3>Curriculum: ${esc(v.versionLabel)}</h3><p>Status: ${esc(v.status)}. Effective: ${esc(v.effectiveFrom || 'Not published')} / ${esc(v.effectiveTo || 'Open')}</p>
      ${requirementsView(v)}
      ${c?.problems?.length ? `<div class="notice notice-warning">${c.problems.map(p => esc(p.problem || p)).join('<br>')}</div>` : ''}
      ${table(['Course','Year','Term','Credits','Requirement',''],(c?.entries || []).map(e => row([esc(e.code),esc(e.yearOfStudy),esc(e.term),esc(e.credits ?? "Not recorded"),esc(e.requirementType || "Not recorded"),v.status === 'draft' ? `<button class="icon-button" title="Remove course" aria-label="Remove ${esc(e.code)}" type="button" data-academic-action="remove" data-id="${esc(e.courseId)}">&times;</button>` : ''])))}
      ${v.status === 'draft' ? form('curriculum',select('Course','courseId',m.data.courses.filter(r => r.status === 'active' && !c?.entries.some(e => e.courseId === r.id))) + input('Year of study','yearOfStudy',1,'number','required min="1" max="8" step="1"') + select('Term','term',{S1:'Semester 1',S2:'Semester 2',S3:'Semester 3',ANY:'Any term'}) + select('Requirement','requirementType',{core:'Core',elective:'Elective'}) + reason(),'Add course') + form('publish-version',input('Effective from','effectiveFrom',v.effectiveFrom,'date')+reason(),'Publish version') : v.status === 'published' ? form('retire-version',input('Effective to','effectiveTo','','date')+reason(),'Retire version') : ''}` : '<p>No curriculum versions.</p>'}`;
  }
  function courses(m,item) {
    if (item?.status === 'retired') return `<p>Retired ${esc(item.effectiveTo)}.</p><p>Prerequisites: ${item.prerequisites.map(esc).join(', ') || 'None'}</p>`;
    return form(item ? 'edit' : 'create',(!item ? input('Course code','code','','text','required pattern="[A-Z]{2,5}[0-9]{3,4}[A-Z]?"')+select('Department','departmentId',m.data.organization.filter(r => r.unitType === 'department' && r.status === 'active')) : '') + input('Title','title',item?.title) + input('Credits','credits',item ? (item.credits ?? '') : 3,'number','required min="0.5" max="60" step="0.5"') + input('Level','level',item ? (item.level ?? '') : 1,'number','required min="1" max="8" step="1"') + (item?.status === 'draft' ? input('Effective from','effectiveFrom',item.effectiveFrom,'date','') : '') + reason(), item ? 'Save changes' : 'Create course') + (item ? `<h3>Prerequisites</h3>${form('prerequisites',m.data.courses.filter(r => r.id !== item.id && r.status === 'active').map(r => `<label><input type="checkbox" name="prerequisiteCourseIds" value="${esc(r.id)}" ${item.prerequisites.includes(r.code) ? 'checked' : ''}> ${esc(r.code)} - ${esc(r.title)}</label>`).join('')+reason(),'Save prerequisites')}${form('retire',input('Effective to','effectiveTo','','date')+reason(),'Retire course')}` : '');
  }
  function periods(m,item) {
    const active = item?.lifecycleStatus === 'active';
    const fields = (!item ? input('Code','code')+select('Period type','periodType',{academic_year:'Academic year',semester:'Semester',term:'Term'})+select('Parent academic year','parentId',m.data.periods.filter(r => r.periodType === 'academic_year'),'',false) : '') + (!active ? input('Name','name',item?.name) + input('Starts on','startsOn',item?.startsOn,'date') + input('Ends on','endsOn',item?.endsOn,'date') : '') + `<h3>Windows</h3>${windows.map(w => input(`${title(w)} opens`,`${w}_opens`,item?.windows?.[w]?.[0],'date','')+input(`${title(w)} closes`,`${w}_closes`,item?.windows?.[w]?.[1],'date','')).join('')}` + reason();
    const choices = {planning:{published:'Published'},published:{planning:'Planning',active:'Active'},active:{closed:'Closed'},closed:{archived:'Archived'},archived:{}};
    return `${!['closed','archived'].includes(item?.lifecycleStatus) ? form(item ? 'edit' : 'create',fields,item ? 'Save period' : 'Create period') : ''}${item ? `<p>Status: ${esc(item.lifecycleStatus)}</p>${Object.keys(choices[item.lifecycleStatus] || {}).length ? lifecycle('periods',choices[item.lifecycleStatus]) : ''}` : ''}`;
  }
  function intakes(m,item) {
    if (!item) return form('create', select('Programme','programmeId',m.data.programmes) + input('Label','label') + input('Capacity','capacity',30,'number','required min="1" step="1"') + input('Applications open','applicationOpensAt','','datetime-local') + input('Applications close','applicationClosesAt','','datetime-local') + input('Starts on','startsOn','','date') + reason(),'Create intake');
    const choices = item.status === 'draft' ? {published:'Published'} : item.status === 'published' ? {closed:'Closed'} : {};
    const localTime = value => {if (!value) return '';const d = new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
    return `<p>Capacity: ${esc(item.capacity)}. Reserved: ${esc(item.placesUsed)}. Available: ${esc(item.placesRemaining)}.</p><p>Applications: ${esc(item.applicationOpensAt)} / ${esc(item.applicationClosesAt)}</p><p>Status: ${esc(item.status)}</p>${item.status !== 'closed' ? form('edit',input('Label','label',item.label)+input('Capacity','capacity',item.capacity,'number','required min="1" step="1"')+(item.status === 'draft' ? input('Applications open','applicationOpensAt',localTime(item.applicationOpensAt),'datetime-local')+input('Applications close','applicationClosesAt',localTime(item.applicationClosesAt),'datetime-local')+input('Starts on','startsOn',item.startsOn,'date') : '')+reason(),'Save intake') : ''}${Object.keys(choices).length ? lifecycle('intakes',choices) : ''}`;
  }
  const removeRow = '<button type="button" class="icon-button" data-academic-remove-row title="Remove row" aria-label="Remove row">&times;</button>';
  const bandRow = (b={}) => `<div class="form-grid" data-academic-row="band">${input('Minimum mark','minMark',b.minMark,'number','required min="0" max="100" step="1"')}${input('Maximum mark','maxMark',b.maxMark,'number','required min="0" max="100" step="1"')}${input('Grade','grade',b.grade)}${input('Points','points',b.points,'number','required min="0" step="0.01"')}<label><input type="checkbox" name="passing" ${b.passing ? 'checked' : ''}> Passing</label>${removeRow}</div>`;
  const classificationRow = (c={}) => `<div class="form-grid" data-academic-row="classification">${input('Minimum GPA','minGpa',c.minGpa,'number','required min="0" step="0.01"')}${input('Classification','label',c.label)}${removeRow}</div>`;
  const resultRow = (r={}) => `<div class="form-grid" data-academic-row="result">${input('Course code','courseCode',r.courseCode)}${input('Credits','credits',r.credits,'number','required min="0.5" step="0.5"')}${input('Mark','mark',r.mark,'number','min="0" max="100" step="1"')}${input('Grade','grade',r.grade,'text','maxlength="20"')}${input('Attempt','attempt',r.attempt || 1,'number','required min="1" step="1"')}${removeRow}</div>`;
  const addRow = (kind,label) => `<button type="button" class="button button-secondary" data-academic-add-row="${kind}">${label}</button>`;
  const resultEditor = (results=[{}]) => `<div data-academic-rows="result">${results.map(resultRow).join('')}</div>${addRow('result','Add result')}`;
  const sampleRow = (s={}) => `<section class="academic-sample" data-academic-row="sample"><header><h3>Worked example</h3>${removeRow}</header><div class="form-grid">${input('Example name','sampleName',s.name,'text','required maxlength="200"')}${input('Expected GPA','expectedGpa',s.expectedGpa,'number','min="0" step="0.0001"')}${input('Expected classification','expectedClassification',s.expectedClassification,'text','maxlength="200"')}<label><input type="checkbox" name="noClassification" ${s.expectedClassification === null ? 'checked' : ''}> No classification</label></div>${resultEditor(s.results?.length ? s.results : [{}])}</section>`;
  const requirementDocument = (code='') => `<div class="academic-requirement-document" data-academic-row="requirement-document">${input('Document type','documentType',code,'text','pattern="[a-z][a-z0-9_]{0,59}" maxlength="60" list="academic-document-types"')}${removeRow}</div>`;
  const requirementCategory = (category={code:'',documents:[]}) => `<section class="academic-sample" data-academic-row="requirement-category"><header><h3>Applicant category</h3>${removeRow}</header>${input('Category code','categoryCode',category.code,'text','pattern="[a-z][a-z0-9_]{0,39}" maxlength="40"')}<div data-academic-rows="requirement-document">${(category.documents.length ? category.documents : ['']).map(requirementDocument).join('')}</div>${addRow('requirement-document','Add category document')}</section>`;
  function requirementsView(version) {
    const requirements=version.requirements || {},documents=requirements.documents || [],categories=Object.entries(requirements.documentsByCategory || {});
    if (version.status!=='draft') return `<h3>Admission requirements</h3>${table(['Applicant category','Required documents'],[row(['All applicants',esc(documents.join(', ') || 'None')]),...categories.map(([code,extra])=>row([esc(code),esc([...new Set([...documents,...extra])].join(', ') || 'None')]))])}`;
    return `<h3>Admission requirements</h3>${form('requirements',`<input type="hidden" name="revision" value="${version.revision}"><datalist id="academic-document-types">${['national_id','prior_transcript','passport','degree_certificate','cv','reference_letter'].map(code=>`<option value="${code}"></option>`).join('')}</datalist><h3>All applicants</h3><div data-academic-rows="requirement-document">${(documents.length ? documents : ['']).map(requirementDocument).join('')}</div>${addRow('requirement-document','Add required document')}<div data-academic-rows="requirement-category">${categories.map(([code,documents])=>requirementCategory({code,documents})).join('')}</div>${addRow('requirement-category','Add applicant category')}<div>${reason()}</div>`,'Save admission requirements')}`;
  }
  const copyVersion = item => `${action('Copy to new version','copy',item.id)}`;
  function versionLifecycle(item) {
    return item.status === 'draft' ? form('publish',input('Effective from','effectiveFrom','','date')+reason(),'Publish version') : item.status === 'published' ? form('retire',input('Effective to','effectiveTo','','date')+reason(),'Retire version') : '';
  }
  function grading(m,item) {
    if (item) return `<p>${esc(item.name)} - Version ${esc(item.version)} - ${esc(item.status)}</p>${copyVersion(item)}${table(['Minimum','Maximum','Grade','Points','Passing'],item.bands.map(b => row([esc(b.minMark),esc(b.maxMark),esc(b.grade),esc(b.points),b.passing ? 'Yes' : 'No'])))}${table(['Minimum GPA','Classification'],item.classifications.map(c => row([esc(c.minGpa),esc(c.label)])))}${versionLifecycle(item)}`;
    const draft=m.copy || {};
    return `${m.copy ? `<p>Based on ${esc(draft.code)} version ${esc(draft.version)}.</p>` : ''}${form('create',input('Code','code',draft.code,'text','required pattern="[a-z0-9_]{3,40}"')+input('Name','name',draft.name)+'<h3>Mark bands</h3>'+`<div data-academic-rows="band">${(draft.bands || [{}]).map(bandRow).join('')}</div>${addRow('band','Add band')}<h3>Classifications</h3><div data-academic-rows="classification">${(draft.classifications || [{}]).map(classificationRow).join('')}</div>${addRow('classification','Add classification')}`+reason(),'Create grading version')}`;
  }
  function gpa(m,item) {
    if (item) return `<p>${esc(item.name)} - Version ${esc(item.version)} - ${esc(item.status)}</p>${copyVersion(item)}<dl><dt>Retakes</dt><dd>${esc(item.rules.retakePolicy)}</dd><dt>Credit weighted</dt><dd>${item.rules.creditWeighted ? 'Yes' : 'No'}</dd><dt>Failed results included</dt><dd>${item.rules.includeFailed ? 'Yes' : 'No'}</dd><dt>Rounding</dt><dd>${esc(item.rules.rounding.mode)}, ${esc(item.rules.rounding.decimals)} decimals</dd><dt>Excluded grades</dt><dd>${item.rules.excludeGrades.map(esc).join(', ') || 'None'}</dd></dl>${table(['Worked example','Expected GPA','Classification'],item.samples.map(s => row([esc(s.name),esc(s.expectedGpa ?? 'None'),esc(s.expectedClassification === undefined ? 'Any' : s.expectedClassification ?? 'None')])))}${versionLifecycle(item)}<h3>Calculation preview</h3>${form('calculate',resultEditor(),'Calculate GPA')}${m.preview ? `<div class="notice" role="status">GPA: ${esc(m.preview.gpa)}. Classification: ${esc(m.preview.classification || 'None')}. Credits counted: ${esc(m.preview.creditsCounted)}.</div>` : ''}`;
    const draft=m.copy || {},rules=draft.rules || {},rounding=rules.rounding || {};
    return `${m.copy ? `<p>Based on ${esc(draft.code)} version ${esc(draft.version)}.</p>` : ''}${form('create',input('Code','code',draft.code,'text','required pattern="[a-z0-9_]{3,40}"')+input('Name','name',draft.name)+select('Grading scheme','gradingSchemeId',m.data.grading.filter(s => s.status === 'published').map(s => ({...s,name:`${s.name} v${s.version}`})),draft.gradingSchemeId)+`<label><input type="checkbox" name="creditWeighted" ${rules.creditWeighted ? 'checked' : ''}> Credit weighted</label><label><input type="checkbox" name="includeFailed" ${rules.includeFailed ? 'checked' : ''}> Include failed results</label>`+select('Retake policy','retakePolicy',{latest:'Latest attempt',best:'Best attempt',all:'All attempts'},rules.retakePolicy)+input('Decimal places','decimals',rounding.decimals ?? 2,'number','required min="0" max="4" step="1"')+select('Rounding','roundingMode',{half_up:'Half up',truncate:'Truncate'},rounding.mode)+`<h3>Excluded grades</h3>${[...new Set(m.data.grading.flatMap(s => s.bands.map(b => b.grade)).concat(['W','EX'],rules.excludeGrades || []))].map(grade => `<label><input type="checkbox" name="excludeGrades" value="${esc(grade)}" ${rules.excludeGrades?.includes(grade) ? 'checked' : ''}> ${esc(grade)}</label>`).join('')}<div data-academic-rows="sample">${(draft.samples?.length ? draft.samples : [{}]).map(sampleRow).join('')}</div>`+addRow('sample','Add worked example')+reason(),'Create GPA version')}`;
  }
  function render(state) {
    if (!window.svuSession.can('master_data.publish')) return '';
    const m = model(state); if (!m.data.organization) return '<p>Loading academic setup...</p>';
    const item = m.data[m.tab].find(r => r.id === m.selected);
    const content = {organization,programmes,courses,periods,intakes,grading,gpa}[m.tab](m,item);
    return `<section class="academic-setup"><nav class="academic-tabs" aria-label="Academic setup sections" role="tablist">${Object.entries(tabs).map(([key,label]) => `<button class="button button-secondary" type="button" role="tab" aria-selected="${m.tab === key}" data-academic-tab="${key}">${label}</button>`).join('')}</nav><div class="academic-layout"><div class="academic-list workspace-picker" aria-label="Academic records">${action('New record','new','')}<div class="workspace-picker-results" tabindex="0" role="region" aria-label="Academic record list">${m.data[m.tab].map(r => `<button class="review-row ${r.id === m.selected ? 'is-selected' : ''}" type="button" data-academic-action="select" data-id="${esc(r.id)}"><strong>${esc(r.code || r.label)}</strong><span>${esc(r.name || r.title || r.label)}</span><span>${esc(r.lifecycleStatus || r.status)}</span></button>`).join('')}</div></div><div class="academic-detail"><h2>${item ? esc(item.code || item.label) : 'New record'}</h2>${content}</div></div></section>`;
  }
  function bind(root,state,{api,act}) {
    root.querySelector('.academic-setup')?.addEventListener('input',event=>{
      const result=event.target.closest('[data-academic-row="result"]');
      if (result) {const mark=result.querySelector('[name=mark]'),grade=result.querySelector('[name=grade]');mark.setCustomValidity((mark.value==='') === (grade.value==='') ? 'Enter either a mark or a grade.' : '');}
      const sample=event.target.closest('[data-academic-row="sample"]');
      if (sample && event.target.name==='noClassification') sample.querySelector('[name=expectedClassification]').disabled=event.target.checked;
    });
    root.querySelector('.academic-setup')?.addEventListener('click',event => {
      const add = event.target.closest('[data-academic-add-row]'), remove = event.target.closest('[data-academic-remove-row]');
      if (state.busy) return;
      if (add) {const kind = add.dataset.academicAddRow,scope=add.closest('[data-academic-row="sample"],[data-academic-row="requirement-category"]') || add.closest('form');scope.querySelector(`[data-academic-rows="${kind}"]`).insertAdjacentHTML('beforeend',{band:bandRow,classification:classificationRow,result:resultRow,sample:sampleRow,'requirement-document':requirementDocument,'requirement-category':requirementCategory}[kind]());}
      if (remove) {const container = remove.closest('[data-academic-rows]');if (container.children.length > 1 || remove.closest('[data-academic-row]').dataset.academicRow==='requirement-category') remove.closest('[data-academic-row]').remove();}
    });
    root.querySelectorAll('[data-academic-tab]').forEach(button => button.addEventListener('click', () => act(async () => {const m = model(state); m.tab = button.dataset.academicTab; m.selected = null; m.copy = null; m.preview = null; await load(state,api);}))); 
    root.querySelectorAll('[data-academic-action]').forEach(button => button.addEventListener('click', () => act(async () => {
      const m = model(state), kind = button.dataset.academicAction, id = button.dataset.id;
      if (kind === 'new') {m.selected = null; m.copy = null; return;}
      if (kind === 'copy' && ['grading','gpa'].includes(m.tab)) {m.copy = structuredClone(m.data[m.tab].find(r=>r.id===id));m.selected = null;m.preview = null;return;}
      if (kind === 'select') {await detail(state,api,id);return;}
      if (kind === 'version') {m.versionId = id; await detail(state,api,m.selected);return;}
      if (kind === 'remove') {await api('DELETE',`${base}/programme-versions/${encodeURIComponent(m.versionId)}/curriculum/${encodeURIComponent(id)}`);await detail(state,api,m.selected);state.notice = 'Course removed from draft.';}
    })));
    root.querySelectorAll('[data-academic-form]').forEach(element => element.addEventListener('submit', event => {
      event.preventDefault(); const data = new FormData(element), values = Object.fromEntries(data), kind = element.dataset.academicForm;
      const rows = kind => Array.from(element.querySelectorAll(`[data-academic-row="${kind}"]`)).map(node => Object.fromEntries(Array.from(node.querySelectorAll('input')).map(i => [i.name,i.type === 'checkbox' ? i.checked : i.type === 'number' ? Number(i.value) : i.value])));
      if (model(state).tab === 'grading' && kind === 'create') {values.bands = rows('band'); values.classifications = rows('classification');}
      const results = scope => Array.from(scope.querySelectorAll('[data-academic-row="result"]')).map(node=>{const field=name=>node.querySelector(`[name="${name}"]`).value;return {courseCode:field('courseCode'),credits:Number(field('credits')),attempt:Number(field('attempt')),...(field('mark') !== '' ? {mark:Number(field('mark'))} : {grade:field('grade')})};});
      if (model(state).tab === 'gpa' && kind === 'create') {const fields={code:values.code,name:values.name,gradingSchemeId:values.gradingSchemeId,reason:values.reason};fields.rules = {creditWeighted:data.has('creditWeighted'),includeFailed:data.has('includeFailed'),retakePolicy:values.retakePolicy,excludeGrades:data.getAll('excludeGrades'),rounding:{decimals:Number(values.decimals),mode:values.roundingMode}};fields.samples = Array.from(element.querySelectorAll('[data-academic-row="sample"]')).map(sample=>{const field=name=>sample.querySelector(`[name="${name}"]`);return {name:field('sampleName').value,expectedGpa:field('expectedGpa').value === '' ? null : Number(field('expectedGpa').value),...(field('noClassification').checked ? {expectedClassification:null} : field('expectedClassification').value ? {expectedClassification:field('expectedClassification').value} : {}),results:results(sample)};});Object.keys(values).forEach(key=>delete values[key]);Object.assign(values,fields);}
      if (kind === 'calculate') values.results = results(element);
      act(async () => {
        const m = model(state); let path = `${base}/${paths[m.tab]}`, method = 'POST';
        if (kind==='requirements') {
          const documents=scope=>Array.from(scope.querySelector('[data-academic-rows="requirement-document"]').querySelectorAll('[name=documentType]'),input=>input.value.trim()).filter(Boolean);
          const categories=Array.from(element.querySelectorAll('[data-academic-row="requirement-category"]')).map(node=>[node.querySelector('[name=categoryCode]').value.trim(),documents(node)]);
          if (categories.some(([code])=>!code) || new Set(categories.map(([code])=>code)).size!==categories.length) throw new Error('Choose a distinct code for each applicant category.');
          await api('PUT',`${base}/programme-versions/${encodeURIComponent(m.versionId)}/requirements`,{revision:Number(values.revision),reason:values.reason,requirements:{documents:documents(element),documentsByCategory:Object.fromEntries(categories)}});
          await detail(state,api,m.selected);state.notice='Academic setup saved.';return;
        }
        if (kind === 'edit') {path += `/${encodeURIComponent(m.selected)}`; method = 'PATCH';}
        else if (['deactivate','reactivate','retire','publish','calculate'].includes(kind)) path += `/${encodeURIComponent(m.selected)}/${kind}`;
        else if (kind === 'version') path += `/${encodeURIComponent(m.selected)}/versions`;
        else if (kind === 'prerequisites') {path += `/${encodeURIComponent(m.selected)}/prerequisites`;method = 'PUT';values.prerequisiteCourseIds = data.getAll('prerequisiteCourseIds');}
        else if (kind === 'curriculum') {path = `${base}/programme-versions/${encodeURIComponent(m.versionId)}/curriculum`; values.yearOfStudy = Number(values.yearOfStudy);}
        else if (kind.endsWith('-version')) path = `${base}/programme-versions/${encodeURIComponent(m.versionId)}/${kind.split('-')[0]}`;
        else if (kind.startsWith('transition:')) path += `/${encodeURIComponent(m.selected)}/transitions`;
        if (m.tab === 'courses') {if (values.credits) values.credits = Number(values.credits); if (values.level) values.level = Number(values.level);}
        if (m.tab === 'intakes') {if (values.capacity) values.capacity = Number(values.capacity); for (const key of ['applicationOpensAt','applicationClosesAt']) if (values[key]) values[key] = new Date(values[key]).toISOString();}
        if (m.tab === 'periods' && ['create','edit'].includes(kind)) {values.windows = {};for (const w of windows) {if (values[`${w}_opens`] || values[`${w}_closes`]) {if (!values[`${w}_opens`] || !values[`${w}_closes`]) throw new Error(`Set both dates for ${title(w)}.`);values.windows[w] = [values[`${w}_opens`],values[`${w}_closes`]];}delete values[`${w}_opens`];delete values[`${w}_closes`];}}
        if (values.parentId === '') {if (kind === 'edit') values.parentId = null;else delete values.parentId;}
        if (!values.effectiveFrom) delete values.effectiveFrom;
        const saved = await api(method,path,values);
        if (kind === 'calculate') {m.preview = saved;return;}
        if (kind === 'create') m.selected = saved.id;
        if (kind === 'version') m.versionId = saved.id;
        await load(state,api); state.notice = 'Academic setup saved.';
      });
    }));
  }
  window.academicSetupUI = {load,render,bind};
})();
