(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const human = (value) => ({system_administrator:'Sysadmin',legacy_super_user:'Super user',legacy_management:'Management',legacy_supervisor:'Supervisor',legacy_reports:'Reports Access Only',legacy_staff:'User'}[value] || String(value ?? "").replaceAll("_"," "));
  function employmentFields(state,current = {}) {
    const units = state.staffUnits || [],categories = state.staffCategories || [],people = (state.staff?.items || []).filter((row) => row.status !== "exited" && row.id !== current.id);
    return `<label class="field"><span>Department</span><select class="input" name="departmentId" required>${units.map((unit) => `<option value="${esc(unit.id)}" ${unit.id === current.departmentId ? "selected" : ""}>${esc(unit.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Staff category</span><select class="input" name="category" required>${categories.map((row) => `<option value="${esc(row.valueCode)}" ${row.valueCode === current.category ? "selected" : ""}>${esc(row.label)}</option>`).join("")}</select></label>
      <label class="field"><span>Grade</span><input class="input" name="grade" maxlength="40" value="${esc(current.grade)}" required></label>
      <label class="field"><span>Supervisor</span><select class="input" name="supervisorStaffId"><option value="">None</option>${people.map((row) => `<option value="${esc(row.id)}" ${row.id === current.supervisorStaffId ? "selected" : ""}>${esc(row.legalName)} (${esc(row.employeeNumber)})</option>`).join("")}</select></label>`;
  }
  function render(state) {
    const data = state.staff;
    if (!data) return "";
    const detail = state.staffDetail,manage = data.capabilities.manage;
    return `<details class="registry-staff" data-staff-panel ${state.staffOpen ? "open" : ""}><summary>Staff records (${data.total})</summary>
      <form class="form form-grid" data-staff-filter><label class="field"><span>Staff name, number or email</span><input class="input" name="q" value="${esc(state.staffFilters?.q)}"></label>
        <label class="field"><span>Staff status</span><select class="input" name="status"><option value="">All</option>${["invited","active","suspended","exited"].map((status) => `<option ${state.staffFilters?.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
        <div><button class="button button-secondary" type="submit">Search staff</button></div></form>
      ${manage ? `<details><summary>Add staff member</summary><form class="form form-grid" data-staff-create>
        <label class="field"><span>Work email</span><input class="input" name="email" type="email" required></label>
        <label class="field"><span>Legal name</span><input class="input" name="legalName" maxlength="200" required></label>
        <label class="field"><span>Preferred name</span><input class="input" name="preferredName" maxlength="100" required></label>
        <label class="field"><span>Employee number (optional)</span><input class="input" name="employeeNumber" maxlength="20" pattern="[A-Z0-9-]{3,20}"></label>
        <label class="field"><span>Engaged on</span><input class="input" name="engagedOn" type="date" required></label>
        <label class="field"><span>Initial role</span><select class="input" name="roleCode">${data.capabilities.invitationRoles.map((role) => `<option value="${role}">${esc(human(role))}</option>`).join("")}</select></label>
        <label class="field"><span>Person already has an account</span><select class="input" name="linkExistingAccount"><option value="false">No - send a new-account invitation</option><option value="true">Yes - offer the appointment to their existing account</option></select></label>
        ${employmentFields(state)}
        <label class="field"><span>Appointment reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>
        <div><button class="button button-primary" type="submit">Create staff record and invite</button></div></form></details>` : ""}
      <ul class="staff-list">${data.items.map((row) => `<li><button type="button" class="review-row" data-staff-detail="${esc(row.id)}"><strong>${esc(row.legalName)} - ${esc(row.employeeNumber)}</strong><span>${esc(row.departmentName)} - ${esc(human(row.category))} ${esc(row.grade)}</span><span>${esc(row.status)}</span></button></li>`).join("") || "<li>No staff records.</li>"}</ul>
      ${detail ? `<section class="staff-detail" data-staff-record="${esc(detail.id)}"><header class="section-header"><h3>${esc(detail.legalName)} (${esc(detail.employeeNumber)})</h3><strong>${esc(detail.status)}</strong></header>
        <p>${esc(detail.email)} - engaged ${esc(detail.engagedOn)}${detail.exitedOn ? ` - exited ${esc(detail.exitedOn)}` : ""}</p>
        ${detail.invitation && detail.status === "invited" ? `<p data-staff-invitation="${esc(detail.invitation.status)}">${{pending_activation:"Waiting for the new account to be activated",pending_acceptance:"Offered to an existing account - waiting for acceptance",declined:"The account holder declined this appointment",withdrawn:"Invitation withdrawn"}[detail.invitation.status] || esc(detail.invitation.status)}</p>` : ""}
        <p>${esc(detail.departmentName)} - ${esc(human(detail.category))} ${esc(detail.grade)}${detail.supervisorName ? ` - reports to ${esc(detail.supervisorName)}${detail.supervisorStatus === "exited" ? " (exited: reassign)" : ""}` : ""}</p>
        <p>Roles: ${detail.roles.length ? detail.roles.map((role) => `${esc(human(role.roleCode))}${role.effectiveTo ? ` (ended ${esc(role.effectiveTo)})` : ""}`).join(", ") : detail.accountId ? "None" : "Granted when the invitation is accepted"}</p>
        <h4>Employment history</h4><ul>${detail.employment.map((row) => `<li>${esc(row.effectiveFrom)} to ${esc(row.effectiveTo || "now")}: ${esc(row.departmentName)}, ${esc(human(row.category))} ${esc(row.grade)} - ${esc(row.reason)}</li>`).join("")}</ul>
        <h4>Status history</h4><ul>${detail.statusHistory.map((row) => `<li>${esc(row.effectiveOn)}: ${esc(row.fromStatus || "new")} to ${esc(row.toStatus)} - ${esc(row.reason)}</li>`).join("")}</ul>
        ${manage && detail.status !== "exited" ? `<details><summary>Change employment</summary><form class="form form-grid" data-staff-employment><input type="hidden" name="revision" value="${detail.revision}">
          ${employmentFields(state,detail)}<label class="field"><span>Effective from</span><input class="input" name="effectiveFrom" type="date" required></label>
          <label class="field"><span>Change reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><div><button class="button button-primary" type="submit">Record employment change</button></div></form></details>
          <details><summary>Change status</summary><form class="form form-grid" data-staff-status><input type="hidden" name="revision" value="${detail.revision}">
          <label class="field"><span>New status</span><select class="input" name="toStatus">${({invited:["exited"],active:["suspended","exited"],suspended:["active","exited"]})[detail.status].map((status) => `<option>${status}</option>`).join("")}</select></label>
          <label class="field"><span>Status effective on</span><input class="input" name="effectiveOn" type="date" required></label>
          <label class="field"><span>Status reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><div><button class="button button-primary" type="submit">Change staff status</button></div></form></details>` : ""}
      </section>` : ""}
    </details>`;
  }
  async function load(state,api) {
    state.staff = await api("GET",`/api/staff?${new URLSearchParams(state.staffFilters || {})}`).catch(() => null);
    if (state.staff && !state.staffUnits) {
      state.staffUnits = (await api("GET","/api/master-data/organization-units?status=active")).filter((unit) => unit.unitType === "department");
      state.staffCategories = (await api("GET","/api/master-data/reference-lists/staff_category")).values.filter((row) => row.status === "active");
    }
  }
  function bind(root,state,{api,act}) {
    root.querySelector("[data-staff-panel]")?.addEventListener("toggle",(event) => {if (event.currentTarget.isConnected) state.staffOpen = event.currentTarget.open;});
    const refresh = async (id) => {await load(state,api); if (id) state.staffDetail = await api("GET",`/api/staff/${id}`);};
    const values = (form) => {const data = Object.fromEntries(new FormData(form)); if (!data.supervisorStaffId) delete data.supervisorStaffId; if (!data.employeeNumber) delete data.employeeNumber; if (data.revision !== undefined) data.revision = Number(data.revision); return data;};
    root.querySelector("[data-staff-filter]")?.addEventListener("submit",(event) => {event.preventDefault(); state.staffFilters = Object.fromEntries(new FormData(event.currentTarget)); act(() => refresh());});
    root.querySelectorAll("[data-staff-detail]").forEach((button) => button.addEventListener("click",() => act(async () => {state.staffDetail = await api("GET",`/api/staff/${button.dataset.staffDetail}`);})));
    root.querySelector("[data-staff-create]")?.addEventListener("submit",(event) => {event.preventDefault(); const body = values(event.currentTarget);
      const link = body.linkExistingAccount === "true"; body.linkExistingAccount = link;
      act(async () => {const created = await api("POST","/api/staff",body); await refresh(created.id); state.notice = link ? `Staff record ${created.employeeNumber} created; the account holder must accept the appointment.` : `Staff record ${created.employeeNumber} created and invitation sent.`;});});
    root.querySelector("[data-staff-employment]")?.addEventListener("submit",(event) => {event.preventDefault(); const body = values(event.currentTarget);
      act(async () => {await api("POST",`/api/staff/${state.staffDetail.id}/employment`,body); await refresh(state.staffDetail.id); state.notice = "Employment change recorded.";});});
    root.querySelector("[data-staff-status]")?.addEventListener("submit",(event) => {event.preventDefault(); const body = values(event.currentTarget);
      act(async () => {await api("POST",`/api/staff/${state.staffDetail.id}/status`,body); await refresh(state.staffDetail.id); state.notice = "Staff status changed.";});});
  }
  window.registryStaffUI = {render,bind,load};
})();
