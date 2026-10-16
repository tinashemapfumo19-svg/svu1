(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const when = (iso) => new Date(iso).toLocaleString([], {weekday:"short",year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
  const pad = (value) => String(value).padStart(2,"0");
  // A datetime-local value plus the browser's offset for that moment, so the server receives an unambiguous start.
  function withOffset(local) {
    const minutes = -new Date(local).getTimezoneOffset(),sign = minutes < 0 ? "-" : "+",abs = Math.abs(minutes);
    return `${local}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }
  function toLocalInput(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function download(name,type,body) {
    const url = URL.createObjectURL(new Blob([body],{type}));
    const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  const csvCell = (value) => {
    const raw = String(value ?? ''),safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g,'""')}"` : safe;
  };

  const venueLabel = (row) => `${row.code} - ${row.name}`;
  function sittingFields(sitting = {},venues = []) {
    const managed = venues.find((row) => row.id === sitting.venueId && row.status === 'active');
    return `<label class="field"><span>Paper</span><input class="input" name="paper" maxlength="60" value="${esc(sitting.paper || "Paper 1")}" ${sitting.orderId ? 'readonly' : ''} required></label>
      <label class="field"><span>Starts</span><input class="input" type="datetime-local" name="startsAt" value="${sitting.startsAt ? toLocalInput(sitting.startsAt) : ""}" required></label>
      <label class="field"><span>Duration (minutes)</span><input class="input" type="number" name="durationMinutes" min="15" max="480" step="15" value="${sitting.durationMinutes || 120}" ${sitting.orderId ? 'readonly' : ''} required></label>
      <label class="field"><span>Venue record</span><select class="input" name="venueId"><option value="">Manual venue</option>${venues.filter((row) => row.status === 'active').map((row) => `<option value="${esc(row.id)}" ${row.id === sitting.venueId ? 'selected' : ''}>${esc(venueLabel(row))} - ${esc(row.campus)} (${row.capacity})</option>`).join('')}</select></label>
      <label class="field"><span>Venue</span><input class="input" name="venue" maxlength="120" value="${esc(managed ? venueLabel(managed) : sitting.venue)}" ${managed ? 'readonly' : ''} required></label>
      <label class="field"><span>Capacity (optional)</span><input class="input" type="number" name="capacity" min="1" max="5000" step="1" value="${managed ? managed.capacity : sitting.capacity ?? ""}" ${managed ? 'readonly' : ''}></label>`;
  }
  function timetable(state) {
    const data = state.examTimetable;
    if (!data) return "";
    const can = data.capabilities,t = data.timetable,byId = Object.fromEntries(data.sittings.map((row) => [row.id,row]));
    const label = (id) => `${byId[id].code} ${byId[id].paper}`;
    const live = data.sittings.filter((row) => row.status === "scheduled");
    return `<section class="exam-timetable" data-exam-timetable="${esc(data.period.id)}">
      <header class="section-header"><h3>${esc(data.period.programmeCode)} ${esc(data.period.intakeLabel)} - ${esc(data.period.name)}</h3>
        <strong data-exam-status>${t ? `${t.status === "published" ? "Published" : "Draft"} revision ${t.revision}` : "No sittings yet"}</strong></header>
      <p>${data.period.assessmentWindow ? `Assessment window ${esc(data.period.assessmentWindow[0])} to ${esc(data.period.assessmentWindow[1])}` : "No assessment window is defined in the academic calendar."}
        ${t?.publishedAt ? ` - last published ${esc(new Date(t.publishedAt).toLocaleDateString())} (revision ${t.publishedRevision})` : ""}</p>
      <ul class="exam-offerings">${data.offerings.map((row) => `<li data-exam-offering="${esc(row.courseId)}"><strong>${esc(row.code)}</strong> ${esc(row.title)} - ${row.candidates} candidate(s), ${row.sittings ? `${row.sittings} sitting(s)` : "<em>no sitting</em>"} <button class="button button-secondary" type="button" data-assessment-load="${esc(data.period.id)}:${esc(row.courseId)}">Marks</button></li>`).join("")}</ul>
      ${data.orders.length ? `<details data-exam-order-panel><summary>Exam orders (${data.orders.length})</summary>${data.orders.map((row) => `<section class="assessment-plan" data-exam-order="${esc(row.id)}">
        <p><strong>${esc(data.offerings.find((entry) => entry.courseId === row.courseId)?.code)} ${esc(row.paper)}</strong> - ${row.durationMinutes} minutes - ${esc(row.status)}${row.sittingId ? ' - sitting scheduled' : ''}</p>
        <p>Paper reference: ${esc(row.paperReference)}. Allowed materials: ${esc(row.materialsAllowed)}</p>${row.requirements ? `<p>${esc(row.requirements)}</p>` : ''}<p>${esc(row.reason)}</p>${row.reviewReason ? `<p>${esc(row.reviewReason)}</p>` : ''}${can.papers && row.status === 'approved' ? `<button class="button button-secondary" type="button" data-exam-papers-open="${esc(row.id)}">Paper custody</button>` : ''}
        ${can.schedule && row.status === 'submitted' && row.submittedBy !== data.accountId ? `<form class="form form-grid" data-exam-order-review="${esc(row.id)}">
          <label class="field"><span>Order decision</span><select class="input" name="outcome"><option value="approved">Approve</option><option value="returned">Return for changes</option></select></label>
          <label class="field"><span>Review reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Review exam order</button></div></form>` : ''}</section>`).join('')}</details>` : ''}
      ${data.clashes.length || data.capacity.length || data.deferredIssues.length || data.resourceIssues.length || data.arrangementIssues.length ? `<div class="exam-issues" data-exam-issues><h4>Resolve before publishing</h4><ul>
        ${data.arrangementIssues.map((row) => `<li data-exam-arrangement-issue>${esc(label(row.sittingId))}: ${esc(row.problem)}</li>`).join('')}
        ${data.resourceIssues.map((row) => `<li data-exam-resource-issue>${esc(label(row.sittingId))}: ${esc(row.problem)}</li>`).join('')}
        ${data.deferredIssues.map((row) => `<li>${esc(label(row.sittingId))}: ${esc(row.problem)}</li>`).join('')}
        ${data.clashes.map((row) => `<li data-exam-clash>${esc(label(row.sittingIds[0]))} overlaps ${esc(label(row.sittingIds[1]))} for ${row.students.length} student(s): ${esc(row.students.slice(0,5).join(", "))}${row.students.length > 5 ? "..." : ""}</li>`).join("")}
        ${data.capacity.map((row) => `<li data-exam-capacity>${esc(row.venue)}: ${row.candidates} candidates for capacity ${row.capacity} (${esc(row.sittingIds.map(label).join(", "))})</li>`).join("")}</ul></div>` : ""}
      ${live.length ? `<div class="result-table-wrap"><table class="result-table"><thead><tr><th>When</th><th>Course</th><th>Paper</th><th>Minutes</th><th>Venue</th></tr></thead><tbody>
        ${live.map((row) => `<tr data-exam-sitting="${esc(row.id)}"><td>${esc(when(row.startsAt))}</td><td>${esc(row.code)}</td><td>${esc(row.paper)}${row.planId ? `<br>Deferred ${esc(row.componentCode)} - ${row.candidates.length} candidate(s)` : ''}</td><td>${row.durationMinutes}</td><td>${esc(row.venue)}${row.capacity ? ` (${row.capacity})` : ""}</td></tr>`).join("")}</tbody></table></div>
        <div><button class="button button-secondary" type="button" data-exam-export>Download timetable (CSV)</button></div>` : "<p>No sittings scheduled.</p>"}
      ${(can.schedule || can.publish) && t?.status === 'published' ? live.map((row) => `<button class="button button-secondary" type="button" data-exam-manifest="${esc(row.id)}">${esc(row.code)} candidate manifest</button>`).join('') : ''}
      ${(can.schedule || can.publish) && t?.status === 'published' ? live.map((row) => `<button class="button button-secondary" type="button" data-exam-seating="${esc(row.id)}">${esc(row.code)} seating</button>`).join('') : ''}
      ${(data.candidateChanges || []).length ? `<section data-exam-candidate-changes><h4>Candidate changes since publication</h4><ul>${data.candidateChanges.map((row) => `<li>${esc(label(row.sittingId))}: ${row.added} added, ${row.removed} removed - ${row.current} current candidates${row.started ? ' - sitting already started' : ''}</li>`).join('')}</ul>
        ${can.schedule && t?.status === 'published' && !data.candidateChanges.some((row) => row.started) ? `<form class="form form-grid" data-exam-candidate-refresh data-revision="${t.revision}"><label class="field"><span>Refresh reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Prepare candidate revision</button></div></form>` : ''}</section>` : ''}
      ${can.schedule ? `${live.map((row) => `<details data-exam-edit-panel="${esc(row.id)}"><summary>Change ${esc(row.code)} ${esc(row.paper)}</summary>
          <form class="form form-grid" data-exam-change="${esc(row.id)}" data-revision="${row.revision}">${sittingFields(row,data.venues)}<label class="field"><span>Change reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Save sitting</button></div></form>
          <form class="form form-grid" data-exam-cancel="${esc(row.id)}" data-revision="${row.revision}"><label class="field"><span>Cancellation reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-secondary" type="submit">Cancel sitting</button></div></form></details>`).join("")}
        <details data-exam-schedule-panel><summary>Schedule a sitting</summary><form class="form form-grid" data-exam-schedule>
          <label class="field"><span>Approved exam order</span><select class="input" name="orderId"><option value="">Direct scheduling</option>${data.orders.filter((row) => row.status === 'approved' && !row.sittingId).map((row) => `<option value="${esc(row.id)}">${esc(data.offerings.find((entry) => entry.courseId === row.courseId)?.code)} ${esc(row.paper)} (${row.durationMinutes} minutes)</option>`).join('')}</select></label>
          <label class="field"><span>Course</span><select class="input" name="courseId" required>${data.offerings.map((row) => `<option value="${esc(row.courseId)}">${esc(row.code)} - ${esc(row.title)}</option>`).join("")}</select></label>
          ${sittingFields({},data.venues)}<label class="field"><span>Scheduling reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Schedule sitting</button></div></form></details>` : ""}
      ${can.schedule ? data.deferredGroups.map((group) => `<details data-deferred-schedule-panel="${esc(group.planId)}:${esc(group.componentCode)}"><summary>Deferred ${esc(data.offerings.find((row) => row.courseId === group.courseId)?.code)} ${esc(group.component.name)}</summary>
        <form class="form form-grid" data-deferred-schedule data-plan="${esc(group.planId)}" data-course="${esc(group.courseId)}" data-component="${esc(group.componentCode)}">
          <label class="field"><span>Approved exam order</span><select class="input" name="orderId"><option value="">Direct scheduling</option>${data.orders.filter((row) => row.courseId === group.courseId && row.status === 'approved' && !row.sittingId).map((row) => `<option value="${esc(row.id)}">${esc(row.paper)} (${row.durationMinutes} minutes)</option>`).join('')}</select></label>
          <fieldset><legend>Candidates</legend>${group.candidates.map((row) => `<label><input type="checkbox" name="registrationIds" value="${esc(row.registrationId)}" checked> ${esc(row.studentNumber)}</label>`).join('')}</fieldset>
          ${sittingFields({paper:`Deferred ${group.componentCode}`},data.venues)}<label class="field"><span>Scheduling reason</span><input class="input" name="reason" maxlength="2000" required></label>
          <div><button class="button button-primary" type="submit">Schedule deferred sitting</button></div></form></details>`).join('') : ''}
      ${live.map((row) => `<details data-exam-invigilators-panel="${esc(row.id)}"><summary>${esc(row.code)} ${esc(row.paper)} invigilators (${row.invigilators.length})</summary>
        ${row.invigilators.length ? `<ul>${row.invigilators.map((entry) => `<li>${esc(entry.employeeNumber)} ${esc(entry.legalName)} - ${entry.role === 'lead' ? 'Lead' : 'Invigilator'}${entry.status !== 'active' ? ` (${esc(entry.status)})` : ''}</li>`).join('')}</ul>` : ''}
        ${can.schedule && !row.completed ? `<form class="form" data-exam-invigilators="${esc(row.id)}" data-revision="${row.revision}">
          <div class="result-table-wrap"><table class="result-table assessment-grid"><thead><tr><th>Assigned</th><th>Staff member</th><th>Role</th></tr></thead><tbody>${data.staff.map((staff) => {
            const allocation = row.invigilators.find((entry) => entry.staffId === staff.id);
            return `<tr><td><input type="checkbox" name="staffIds" value="${esc(staff.id)}" aria-label="Assign ${esc(staff.employeeNumber)}" ${allocation ? 'checked' : ''}></td><td>${esc(staff.employeeNumber)} ${esc(staff.legalName)}</td>
              <td><select class="input" name="role:${esc(staff.id)}" aria-label="${esc(staff.employeeNumber)} invigilation role"><option value="invigilator">Invigilator</option><option value="lead" ${allocation?.role === 'lead' ? 'selected' : ''}>Lead</option></select></td></tr>`;
          }).join('')}</tbody></table></div><label class="field"><span>Allocation reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Save invigilators</button></div></form>` : ''}</details>`).join('')}
      ${live.map((row) => `${row.arrangements.length ? `<details data-operational-arrangements="${esc(row.id)}"><summary>${esc(row.code)} ${esc(row.paper)} operational arrangements (${row.arrangements.length})</summary><ul>${row.arrangements.map((entry) => `<li>${esc(entry.studentNumber)} - ${entry.extraMinutes} extra minutes${entry.venue ? ` - ${esc(entry.venue)}` : ''} - ${esc(entry.instruction)}</li>`).join('')}</ul></details>` : ''}${can.arrangements ? `<button class="button button-secondary" type="button" data-arrangements-open="${esc(row.id)}">Review candidate arrangements</button>` : ''}`).join('')}
      ${can.publish && t?.status === "draft" ? (t.preparedBy === data.accountId ? `<p data-exam-publish-blocked>Another colleague must publish this revision because you made the latest change.</p>`
        : `<form class="form form-grid" data-exam-publish data-revision="${t.revision}"><label class="field"><span>Publication reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Publish timetable</button></div></form>`) : ""}
    </section>`;
  }
  function venueFields(row = {}) {
    return `${row.id ? '' : '<label class="field"><span>Venue code</span><input class="input" name="code" pattern="[A-Z0-9][A-Z0-9_-]{1,19}" maxlength="20" required></label>'}
      <label class="field"><span>Name</span><input class="input" name="name" maxlength="90" value="${esc(row.name)}" required></label>
      <label class="field"><span>Campus</span><input class="input" name="campus" maxlength="80" value="${esc(row.campus)}" required></label>
      <label class="field"><span>Location</span><input class="input" name="location" maxlength="120" value="${esc(row.location)}" required></label>
      <label class="field"><span>Capacity</span><input class="input" type="number" name="capacity" min="1" max="5000" value="${row.capacity || ''}" required></label>
      ${row.id ? `<label class="field"><span>Status</span><select class="input" name="status"><option value="active">Active</option><option value="inactive" ${row.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></label>` : ''}
      <label class="field"><span>Record reason</span><input class="input" name="reason" maxlength="2000" required></label>`;
  }
  function venueCatalogue(state) {
    const data = state.examVenues;
    if (!data) return '';
    return `<details class="registry-exams" data-exam-venues-panel ${state.examVenuesOpen ? 'open' : ''}><summary>Exam venues (${data.items.length})</summary>
      ${data.items.map((row) => `<details data-exam-venue-panel="${esc(row.id)}" ${state.examVenueOpen?.[row.id] ? 'open' : ''}><summary>${esc(venueLabel(row))} - ${esc(row.campus)} - ${row.capacity} seats - ${esc(row.status)}</summary>
        <p>${esc(row.location)} - revision ${row.revision}</p>${data.capabilities.manage ? `<form class="form form-grid" data-exam-venue="${esc(row.id)}" data-revision="${row.revision}">${venueFields(row)}<div><button class="button button-primary" type="submit">Save venue</button></div></form>
          <button class="button button-secondary" type="button" data-exam-venue-history="${esc(row.id)}">Record history</button>${(state.examVenueHistory?.[row.id] || []).map((entry) => `<p>v${entry.revision}: ${esc(entry.snapshot.name)} - ${entry.snapshot.capacity} seats - ${esc(entry.snapshot.status)} - ${esc(entry.reason)}</p>`).join('')}` : ''}</details>`).join('')}
      ${data.capabilities.manage ? `<details data-exam-venue-create-panel><summary>Register venue</summary><form class="form form-grid" data-exam-venue="">${venueFields()}<div><button class="button button-primary" type="submit">Register venue</button></div></form></details>` : ''}</details>`;
  }
  function duties(state) {
    if (!state.examDuties?.length) return '';
    return `<section class="student-exams" data-exam-duties><h2>Invigilation duties</h2>${state.examDuties.map((period) => `<section><h3>${esc(period.name)}</h3>
      <div class="result-table-wrap"><table class="result-table"><thead><tr><th>When</th><th>Course</th><th>Paper</th><th>Role</th><th>Venue</th></tr></thead><tbody>
      ${period.sittings.map((row) => `<tr data-exam-duty="${esc(row.id)}"><td>${esc(when(row.startsAt))}</td><td>${esc(row.code)}</td><td>${esc(row.paper)}</td><td>${row.role === 'lead' ? 'Lead' : 'Invigilator'}</td><td>${esc(row.venue)}${row.venueLocation ? `<br>${esc(row.venueLocation)}` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${period.sittings.some((row) => row.arrangements.length) ? `<ul data-duty-arrangements>${period.sittings.flatMap((row) => row.arrangements.map((entry) => `<li>${esc(row.code)} ${esc(entry.studentNumber)} - ${entry.extraMinutes} extra minutes - ${esc(entry.instruction)}</li>`)).join('')}</ul>` : ''}${period.sittings.map((row) => `<button class="button button-secondary" type="button" data-exam-manifest="${esc(row.id)}" data-own="true">${esc(row.code)} room manifest</button>`).join('')}<button class="button button-secondary" type="button" data-student-exam-ics="${esc(period.periodId)}">Add to calendar (.ics)</button></section>`).join('')}</section>`;
  }
  function manifestPanel(state) {
    const data = state.examManifest;
    if (!data) return '';
    return `<section data-exam-manifest-panel><header class="section-header"><h3>${esc(data.code)} ${esc(data.paper)} candidate manifest</h3><button class="button button-secondary" type="button" data-exam-manifest-close>Close</button></header>
      <p>${data.archived ? 'Historical publication' : 'Published revision'} ${data.publishedRevision} - ${esc(when(data.publishedAt))}${data.seating ? ` - seating revision ${data.seating.revision}` : ''}</p>
      ${data.archived && data.seatingEditions.length ? `<label class="field"><span>Historical seating</span><select class="input" data-publication-seating><option value="0" ${data.seatRevision === 0 ? 'selected' : ''}>Original manifest - no seats</option>${data.seatingEditions.map((entry) => `<option value="${entry.revision}" ${entry.revision === data.seatRevision ? 'selected' : ''}>Revision ${entry.revision} - ${entry.assigned} seats - ${esc(when(entry.publishedAt))}</option>`).join('')}</select></label>` : ''}
      <button class="button button-secondary" type="button" data-exam-manifest-export title="Download candidate manifest (CSV)">&#8595; CSV</button>
      ${data.rooms.map((room) => `<section data-manifest-room="${esc(room.key)}"><h4>${esc(room.venue)}</h4><p>${esc(room.location)} - ${esc(when(room.startsAt))} - ${room.durationMinutes} minutes - ${room.candidates.length} candidate${room.candidates.length === 1 ? '' : 's'}</p>
        <div class="result-table-wrap"><table class="result-table"><thead><tr><th>Student number</th><th>Seat</th><th>Extra minutes</th><th>End time</th><th>Operational instruction</th></tr></thead><tbody>${room.candidates.map((candidate) => `<tr data-manifest-candidate="${esc(candidate.studentNumber)}"><td>${esc(candidate.studentNumber)}</td><td>${esc(candidate.seat)}</td><td>${candidate.extraMinutes}</td><td>${esc(when(candidate.endsAt))}</td><td>${esc(candidate.instruction)}</td></tr>`).join('')}</tbody></table></div>${room.candidates.length ? '' : '<p>No candidates.</p>'}</section>`).join('')}</section>`;
  }
  function seatingPanel(state) {
    const data = state.examSeating;if (!data) return '';
    const plan = data.plan,edit = data.capabilities.prepare && !data.started;
    const tables = data.rooms.map((room) => `<section data-seating-room="${esc(room.key)}"><h4>${esc(room.venue)}</h4><p>${esc(room.location)}</p><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Student number</th><th>Published seat</th><th>Draft seat</th></tr></thead><tbody>${room.candidates.map((row) => {
      const seat = plan?.entries.find((entry) => entry.studentNumber === row.studentNumber)?.seat || '',published = plan?.publishedSnapshot?.entries.find((entry) => entry.studentNumber === row.studentNumber)?.seat || '';
      return `<tr><td>${esc(row.studentNumber)}</td><td>${esc(published)}</td><td>${edit ? `<input class="input" data-seat-candidate="${esc(row.studentNumber)}" data-room="${esc(room.key)}" aria-label="${esc(row.studentNumber)} seat" maxlength="30" value="${esc(seat)}">` : esc(seat)}</td></tr>`;
    }).join('')}</tbody></table></div></section>`).join('');
    return `<section data-exam-seating-panel><header class="section-header"><h3>${esc(data.code)} ${esc(data.paper)} seating</h3><button class="button button-secondary" type="button" data-exam-seating-close aria-label="Close seating" title="Close seating">&#215;</button></header>
      <p>Timetable publication ${data.publishedRevision} - ${plan ? `${plan.stale ? 'Stale' : plan.status === 'published' ? 'Published' : 'Draft'} seating revision ${plan.revision}` : 'No seating plan'}${data.started ? ' - sitting started' : ''}</p>
      ${edit ? `<form class="form" data-exam-seating-save>${tables}<button class="button button-secondary" type="button" data-exam-seating-clear>Clear seats</button><label class="field"><span>Seating reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Save seating draft</button></div></form>` : tables}
      ${plan && !plan.stale && plan.status === 'draft' && data.capabilities.publish && !data.started ? plan.preparedBy === data.accountId ? '<p data-seating-publish-blocked>Another colleague must publish this seating revision.</p>' : `<form class="form form-grid" data-exam-seating-publish><label class="field"><span>Publication reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Publish seating</button></div></form>` : ''}
      ${plan ? `<button class="button button-secondary" type="button" data-exam-seating-history>Seating history</button>${state.examSeatingHistory ? `<details data-seating-history open><summary>Seating revisions (${state.examSeatingHistory.length})</summary>${state.examSeatingHistory.map((row) => `<section><h4>Revision ${row.revision} - ${esc(row.action)}</h4><p>${esc(row.reason)} - ${esc(when(row.recordedAt))}</p><ul>${row.snapshot.entries.map((entry) => `<li>${esc(entry.studentNumber)} - ${esc(entry.roomKey)} - ${esc(entry.seat)}</li>`).join('')}</ul></section>`).join('')}</details>` : ''}` : ''}</section>`;
  }
  function publicationHistory(state) {
    const data = state.examPublications;if (!data?.items) return '';
    return `<details class="registry-exams" data-exam-publications-panel ${state.examPublicationsOpen ? 'open' : ''}><summary>Examination publication history (${data.total})</summary>
      <form class="form form-grid" data-exam-publications-search><label class="field"><span>Programme, intake or period</span><input class="input" name="q" maxlength="100" value="${esc(data.q)}"></label><div><button class="button button-secondary" type="submit">Search</button></div></form>
      <ul>${data.items.map((row) => `<li><button class="button button-secondary" type="button" data-exam-publication="${esc(row.periodId)}" data-revision="${row.revision}">${esc(row.programmeCode)} ${esc(row.intakeLabel)} - ${esc(row.name)} - revision ${row.revision}</button> ${esc(when(row.publishedAt))} - ${row.sittingCount} sitting(s)${row.origin === 'retained' ? ' - retained snapshot' : ''}</li>`).join('')}</ul>
      ${data.items.length ? `<p>${data.offset+1}-${data.offset+data.items.length} of ${data.total}</p>` : '<p>No published editions.</p>'}
      <button class="button button-secondary" type="button" data-publications-page="${Math.max(0,data.offset-data.limit)}" ${data.offset === 0 ? 'disabled' : ''} aria-label="Previous publications" title="Previous publications">&#8592;</button>
      <button class="button button-secondary" type="button" data-publications-page="${data.offset+data.limit}" ${data.offset+data.items.length >= data.total ? 'disabled' : ''} aria-label="Next publications" title="Next publications">&#8594;</button></details>`;
  }
  function publicationPanel(state) {
    const data = state.examPublication;if (!data) return '';
    return `<section data-exam-publication-panel><header class="section-header"><h3>${esc(data.programmeCode)} ${esc(data.intakeLabel)} - ${esc(data.name)}</h3><button class="button button-secondary" type="button" data-exam-publication-close aria-label="Close publication" title="Close publication">&#215;</button></header>
      <p>Historical publication ${data.revision} - ${esc(when(data.publishedAt))}${data.origin === 'retained' ? ' - retained snapshot' : ''}</p><p>${esc(data.reason)}</p>
      ${data.sittings.length ? `<div class="result-table-wrap"><table class="result-table"><thead><tr><th>When</th><th>Course</th><th>Paper</th><th>Minutes</th><th>Venue</th><th>Candidates</th><th>Invigilators</th></tr></thead><tbody>${data.sittings.map((row) => `<tr><td>${esc(when(row.startsAt))}</td><td>${esc(row.code)}</td><td>${esc(row.paper)}</td><td>${row.durationMinutes}</td><td>${esc(row.venue)}</td><td>${row.candidateCount ?? 'Not frozen'}</td><td>${row.invigilators.map((staff) => `${esc(staff.employeeNumber)} ${esc(staff.legalName)} (${esc(staff.role)})`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>` : '<p>No sittings in this publication.</p>'}
      ${data.sittings.filter((row) => row.manifestAvailable).map((row) => `<button class="button button-secondary" type="button" data-publication-manifest="${esc(row.id)}">${esc(row.code)} historical manifest</button>`).join('')}</section>`;
  }
  function render(state) {
    const periods = state.examPeriods;
    return `${duties(state)}${venueCatalogue(state)}${periods?.length ? `<details class="registry-exams" data-exams-panel ${state.examsOpen ? "open" : ""}><summary>Examination timetables (${periods.length} period(s))</summary>
      <ul class="exam-periods ui-rows">${periods.map((row) => `<li class="ui-row">${window.svuUI.ico("calendar", "lavender", "ui-icon-sm")}<div><button class="button button-secondary" type="button" data-exam-period="${esc(row.id)}">${esc(row.programmeCode)} ${esc(row.intakeLabel)} - ${esc(row.name)}</button></div>${window.svuUI.status(row.timetableStatus || "not_started")}</li>`).join("")}</ul>
      ${timetable(state)}</details>` : ''}${publicationHistory(state)}${publicationPanel(state)}${manifestPanel(state)}${seatingPanel(state)}`;
  }
  async function load(state,api) {
    state.examPeriods = await api("GET","/api/exams/periods").catch(() => null);
    state.examVenues = await api('GET','/api/exams/venues').catch(() => null);
    state.examDuties = await api('GET','/api/exams/duties/me').catch(() => null);
    state.examVenueHistory = null;
    state.examPublications = await api('GET','/api/exams/publications').catch(() => null);
  }
  function bind(root,state,{api,act}) {
    bindStudent(root,state.examDuties || []);
    const publicationPath = (data) => `/api/exams/periods/${data.periodId}/publications/${data.publishedRevision ?? data.revision}`;
    const searchPublications = async (offset,q) => {
      const query = new URLSearchParams({offset:String(offset),q,limit:String(state.examPublications?.limit || 25)});
      state.examPublication = null;if (state.examManifest?.archived) state.examManifest = null;
      state.examPublications = await api('GET',`/api/exams/publications?${query}`);
    };
    root.querySelector('[data-exam-publications-panel]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.examPublicationsOpen = event.currentTarget.open;});
    root.querySelector('[data-exam-publications-search]')?.addEventListener('submit',(event) => {
      event.preventDefault();const q = new FormData(event.target).get('q');act(() => searchPublications(0,q));
    });
    root.querySelectorAll('[data-publications-page]').forEach((button) => button.addEventListener('click',() => act(() => searchPublications(Number(button.dataset.publicationsPage),state.examPublications.q))));
    root.querySelectorAll('[data-exam-publication]').forEach((button) => button.addEventListener('click',() => act(async () => {
      state.examManifest = null;state.examPublication = null;
      state.examPublication = await api('GET',publicationPath({periodId:button.dataset.examPublication,revision:Number(button.dataset.revision)}));
    })));
    root.querySelector('[data-exam-publication-close]')?.addEventListener('click',() => act(async () => {state.examPublication = null;if (state.examManifest?.archived) state.examManifest = null;}));
    root.querySelectorAll('[data-publication-manifest]').forEach((button) => button.addEventListener('click',() => act(async () => {
      state.examManifest = null;state.examManifestSelf = false;
      state.examManifest = await api('GET',`${publicationPath(state.examPublication)}/sittings/${button.dataset.publicationManifest}/manifest`);
    })));
    root.querySelector('[data-publication-seating]')?.addEventListener('change',(event) => {
      const selected = state.examManifest,revision = Number(event.target.value);
      act(async () => {state.examManifest = null;state.examManifest = await api('GET',`${publicationPath(selected)}/sittings/${selected.sittingId}/manifest?seatRevision=${revision}`);});
    });
    const seatingPath = (id) => `/api/exams/sittings/${id}/seating`;
    root.querySelectorAll('[data-exam-seating]').forEach((button) => button.addEventListener('click',() => act(async () => {
      state.examSeating = null;state.examSeatingHistory = null;state.examSeating = await api('GET',seatingPath(button.dataset.examSeating));
    })));
    root.querySelector('[data-exam-seating-close]')?.addEventListener('click',() => act(async () => {state.examSeating = null;state.examSeatingHistory = null;}));
    root.querySelector('[data-exam-seating-clear]')?.addEventListener('click',() => root.querySelectorAll('[data-seat-candidate]').forEach((input) => {input.value = '';}));
    const seatingInput = (reason) => ({revision:state.examSeating.plan?.revision || 0,publishedRevision:state.examSeating.publishedRevision,manifestDigest:state.examSeating.digest,reason});
    root.querySelector('[data-exam-seating-save]')?.addEventListener('submit',(event) => {
      event.preventDefault();const reason = new FormData(event.target).get('reason'),entries = [...event.target.querySelectorAll('[data-seat-candidate]')].filter((input) => input.value.trim()).map((input) => ({roomKey:input.dataset.room,studentNumber:input.dataset.seatCandidate,seat:input.value}));
      act(async () => {state.examSeating = await api('POST',seatingPath(state.examSeating.sittingId),{...seatingInput(reason),entries});state.examSeatingHistory = null;state.examManifest = null;state.notice = 'Seating draft saved.';});
    });
    root.querySelector('[data-exam-seating-publish]')?.addEventListener('submit',(event) => {
      event.preventDefault();const reason = new FormData(event.target).get('reason');
      act(async () => {state.examSeating = await api('POST',`${seatingPath(state.examSeating.sittingId)}/publish`,seatingInput(reason));state.examSeatingHistory = null;state.examManifest = null;state.notice = 'Seating published.';});
    });
    root.querySelector('[data-exam-seating-history]')?.addEventListener('click',() => act(async () => {state.examSeatingHistory = await api('GET',`${seatingPath(state.examSeating.sittingId)}/history`);}));
    const manifestPath = (id,self,edition) => edition?.archived ? `${publicationPath(edition)}/sittings/${id}/manifest?seatRevision=${edition.seatRevision}` : `/api/exams/${self ? 'me/' : ''}sittings/${id}/manifest`;
    root.querySelectorAll('[data-exam-manifest]').forEach((button) => button.addEventListener('click',() => act(async () => {
      state.examManifest = null;state.examManifestSelf = button.dataset.own === 'true';
      state.examManifest = await api('GET',manifestPath(button.dataset.examManifest,state.examManifestSelf));
    })));
    root.querySelector('[data-exam-manifest-close]')?.addEventListener('click',() => act(async () => {state.examManifest = null;}));
    root.querySelector('[data-exam-manifest-export]')?.addEventListener('click',() => act(async () => {
      const selected = state.examManifest;state.examManifest = null;
      const fresh = await api('GET',manifestPath(selected.sittingId,state.examManifestSelf,selected));
      const rows = [['publication_revision','sitting_revision','course','paper','venue','location','starts_at','student_number','extra_minutes','ends_at','operational_instruction','manifest_digest','seat','seating_revision','seating_digest','historical_edition','publication_digest'],
        ...fresh.rooms.flatMap((room) => room.candidates.map((candidate) => [fresh.publishedRevision,fresh.sittingRevision,fresh.code,fresh.paper,room.venue,room.location,room.startsAt,candidate.studentNumber,candidate.extraMinutes,candidate.endsAt,candidate.instruction,fresh.digest,candidate.seat,fresh.seating?.revision,fresh.seating?.digest,fresh.archived ? 'historical' : '',fresh.publicationDigest]))];
      download(`exam-candidates-${fresh.sittingId}-r${fresh.publishedRevision}${fresh.archived ? `-historical-seats-${fresh.seatRevision}` : ''}.csv`,'text/csv',rows.map((row) => row.map(csvCell).join(',')).join('\r\n')+'\r\n');
      state.examManifest = fresh;
    }));
    root.querySelector('[data-exam-venues-panel]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.examVenuesOpen = event.currentTarget.open;});
    root.querySelectorAll('[data-exam-venue-panel]').forEach((panel) => panel.addEventListener('toggle',() => {if (panel.isConnected) {state.examVenueOpen ||= {};state.examVenueOpen[panel.dataset.examVenuePanel] = panel.open;}}));
    root.querySelectorAll('[data-exam-venue]').forEach((form) => form.addEventListener('submit',(event) => {
      event.preventDefault(); const fields = Object.fromEntries(new FormData(form));
      act(async () => {await api('POST',`/api/exams/venues${form.dataset.examVenue ? `/${form.dataset.examVenue}` : ''}`,{...fields,capacity:Number(fields.capacity),...(form.dataset.examVenue ? {revision:Number(form.dataset.revision)} : {})});
        state.examVenues = await api('GET','/api/exams/venues'); if (state.examTimetable) state.examTimetable = await api('GET',`/api/exams/periods/${state.examTimetable.period.id}`); state.notice = form.dataset.examVenue ? 'Venue updated.' : 'Venue registered.';});
    }));
    root.querySelectorAll('[data-exam-venue-history]').forEach((button) => button.addEventListener('click',() => act(async () => {state.examVenueHistory ||= {};state.examVenueHistory[button.dataset.examVenueHistory] = await api('GET',`/api/exams/venues/${button.dataset.examVenueHistory}/history`);})));
    root.querySelector("[data-exams-panel]")?.addEventListener("toggle",(event) => {if (event.currentTarget.isConnected) state.examsOpen = event.currentTarget.open;});
    root.querySelectorAll("[data-exam-period]").forEach((button) => button.addEventListener("click",() => act(async () => {state.examSeating = null;state.examSeatingHistory = null;state.examManifest = null;state.examTimetable = await api("GET",`/api/exams/periods/${button.dataset.examPeriod}`);})));
    const data = state.examTimetable;
    if (!data) return;
    const refreshList = async () => {state.examManifest = null;state.examSeating = null;state.examSeatingHistory = null;state.examPeriods = await api("GET","/api/exams/periods").catch(() => state.examPeriods);
      if (state.examPublications) state.examPublications = await api('GET',`/api/exams/publications?${new URLSearchParams({q:state.examPublications.q || '',offset:'0'})}`);
    };
    const sitting = (values) => ({paper:values.paper,startsAt:withOffset(values.startsAt),durationMinutes:Number(values.durationMinutes),venue:values.venue,capacity:values.capacity ? Number(values.capacity) : null,...(values.venueId ? {venueId:values.venueId} : {venueId:null}),reason:values.reason});
    root.querySelectorAll('[name="venueId"]').forEach((select) => select.addEventListener('change',() => {
      const form = select.form,venue = data.venues.find((row) => row.id === select.value);
      form.elements.venue.readOnly = Boolean(venue); form.elements.capacity.readOnly = Boolean(venue);
      form.elements.venue.value = venue ? venueLabel(venue) : ''; form.elements.capacity.value = venue ? venue.capacity : '';
    }));
    root.querySelectorAll('[data-exam-invigilators]').forEach((form) => form.addEventListener('submit',(event) => {
      event.preventDefault(); const fields = new FormData(form),entries = fields.getAll('staffIds').map((staffId) => ({staffId,role:fields.get(`role:${staffId}`)}));
      act(async () => {state.examTimetable = await api('POST',`/api/exams/sittings/${form.dataset.examInvigilators}/invigilators`,{revision:Number(form.dataset.revision),entries,reason:fields.get('reason')}); await refreshList(); state.notice = 'Invigilators saved.';});
    }));
    root.querySelectorAll('[data-exam-schedule] [name="orderId"], [data-deferred-schedule] [name="orderId"]').forEach((select) => select.addEventListener('change',(event) => {
      const form = event.target.form,order = data.orders.find((row) => row.id === event.target.value);
      for (const field of ['paper','durationMinutes']) {if (order) form.elements[field].value = order[field]; form.elements[field].readOnly = Boolean(order);}
      if (order && form.elements.courseId) form.elements.courseId.value = order.courseId;
    }));
    root.querySelectorAll('[data-exam-order-review]').forEach((form) => form.addEventListener('submit',(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      act(async () => {state.examTimetable = await api('POST',`/api/exams/orders/${form.dataset.examOrderReview}/review`,values); state.notice = 'Exam order reviewed.';});
    }));
    root.querySelector("[data-exam-schedule]")?.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.target));
      act(async () => {state.examTimetable = await api("POST",`/api/exams/periods/${data.period.id}/sittings`,{courseId:values.courseId,...sitting(values),...(values.orderId ? {orderId:values.orderId} : {})}); await refreshList(); state.notice = "Sitting scheduled.";});
    });
    root.querySelectorAll('[data-deferred-schedule]').forEach((form) => form.addEventListener('submit',(event) => {
      event.preventDefault(); const fields = new FormData(form),values = Object.fromEntries(fields);
      act(async () => {state.examTimetable = await api('POST',`/api/exams/periods/${data.period.id}/sittings`,{courseId:form.dataset.course,...sitting(values),...(values.orderId ? {orderId:values.orderId} : {}),deferred:{planId:form.dataset.plan,componentCode:form.dataset.component,registrationIds:fields.getAll('registrationIds')}}); await refreshList(); state.notice = 'Deferred sitting scheduled.';});
    }));
    root.querySelectorAll("[data-exam-change]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      act(async () => {state.examTimetable = await api("POST",`/api/exams/sittings/${form.dataset.examChange}`,{revision:Number(form.dataset.revision),...sitting(values)}); await refreshList(); state.notice = "Sitting changed.";});
    }));
    root.querySelectorAll("[data-exam-cancel]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      act(async () => {state.examTimetable = await api("POST",`/api/exams/sittings/${form.dataset.examCancel}`,{revision:Number(form.dataset.revision),cancel:true,reason:values.reason}); await refreshList(); state.notice = "Sitting cancelled.";});
    }));
    root.querySelector("[data-exam-publish]")?.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.target));
      act(async () => {state.examTimetable = await api("POST",`/api/exams/periods/${data.period.id}/publish`,{revision:Number(event.target.dataset.revision),reason:values.reason}); await refreshList(); state.notice = "Timetable published and candidates notified.";});
    });
    root.querySelector('[data-exam-candidate-refresh]')?.addEventListener('submit',(event) => {
      event.preventDefault();const values = Object.fromEntries(new FormData(event.target));
      act(async () => {state.examTimetable = await api('POST',`/api/exams/periods/${data.period.id}/refresh-candidates`,{revision:Number(event.target.dataset.revision),reason:values.reason});await refreshList();state.notice = 'Candidate revision prepared for independent publication.';});
    });
    root.querySelector("[data-exam-export]")?.addEventListener("click",() => {
      const rows = [["course","title","paper","starts_at","duration_minutes","venue","candidates"],...data.sittings.filter((row) => row.status === "scheduled").map((row) =>
        [row.code,row.title,row.paper,row.startsAt,row.durationMinutes,row.venue,row.planId ? row.candidates.length : data.offerings.find((entry) => entry.courseId === row.courseId)?.candidates ?? 0])];
      download(`exam-timetable-${data.period.programmeCode}-${data.period.name}.csv`.replace(/\s+/g,"-"),"text/csv",rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n");
    });
  }

  // Student portal: the published timetable for their own courses, with a calendar file.
  function studentView(periods) {
    if (!periods?.length) return "";
    return `<section class="student-exams" data-student-exams><h2>Examination timetable</h2>
      ${periods.map((period) => `<section data-student-exam-period="${esc(period.periodId)}"><h3>${esc(period.name)}</h3>
        <div class="result-table-wrap"><table class="result-table"><thead><tr><th>When</th><th>Course</th><th>Paper</th><th>Minutes</th><th>Venue</th></tr></thead><tbody>
        ${period.sittings.map((row) => `<tr data-student-exam="${esc(row.id)}"><td>${esc(when(row.startsAt))}</td><td>${esc(row.code)}</td><td>${esc(row.paper)}</td><td>${row.durationMinutes}</td><td>${esc(row.venue)}${row.venueLocation ? `<br>${esc(row.venueLocation)}` : ''}${row.seat ? `<br><span data-student-seat>Seat ${esc(row.seat)}</span>` : ''}</td></tr>`).join("")}</tbody></table></div>
        ${period.sittings.map((row) => `${row.arrangement ? `<p data-student-arrangement>${esc(row.code)} - ${row.arrangement.extraMinutes} extra minutes - ${esc(row.arrangement.instruction)}</p>` : ''}${Date.parse(row.startsAt) > Date.now() ? `<button class="button button-secondary" type="button" data-arrangements-open="${esc(row.id)}">${esc(row.code)} arrangement request</button>` : ''}`).join('')}<div><button class="button button-secondary" type="button" data-student-exam-ics="${esc(period.periodId)}">Add to calendar (.ics)</button></div></section>`).join("")}</section>`;
  }
  const icsTime = (iso) => new Date(iso).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
  const icsText = (value) => String(value).replace(/[\\,;]/g,(char) => `\\${char}`).replace(/\r?\n/g,"\\n");
  function bindStudent(root,periods) {
    root.querySelectorAll("[data-student-exam-ics]").forEach((button) => button.addEventListener("click",() => {
      const period = periods.find((row) => row.periodId === button.dataset.studentExamIcs);
      const events = period.sittings.map((row) => ["BEGIN:VEVENT",`UID:${row.id}@southvalley.exams`,`DTSTAMP:${icsTime(period.publishedAt)}`,`DTSTART:${icsTime(row.startsAt)}`,
        `DTEND:${icsTime(new Date(new Date(row.startsAt).getTime() + row.durationMinutes * 60000).toISOString())}`,`SUMMARY:${icsText(`${row.code} ${row.paper} examination`)}`,`LOCATION:${icsText(row.venueLocation ? `${row.venue} - ${row.venueLocation}` : row.venue)}`,...(row.seat ? [`DESCRIPTION:${icsText(`Seat ${row.seat}`)}`] : []),"END:VEVENT"].join("\r\n"));
      download(`exams-${period.name}.ics`.replace(/\s+/g,"-"),"text/calendar",["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//South Valley University//Exams//EN",...events,"END:VCALENDAR"].join("\r\n") + "\r\n");
    }));
  }
  window.registryExamsUI = {render,load,bind,studentView,bindStudent};
})();
