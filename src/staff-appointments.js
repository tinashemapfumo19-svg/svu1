(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const human = (value) => String(value ?? "").replace(/_/g," ");
  // A staff appointment offered to an account the person already has: nothing changes until they accept.
  function render(list) {
    if (!list?.length) return "";
    return `<section class="staff-appointments notice" data-staff-appointments><h2>Staff appointment</h2>
      ${list.map((row) => `<article data-staff-appointment="${esc(row.invitationId)}"><p>South Valley University has appointed you as staff member <strong>${esc(row.employeeNumber)}</strong>:
        ${esc(row.departmentName)}, ${esc(human(row.category))} ${esc(row.grade)}, from ${esc(row.engagedOn)}, with the ${esc(human(row.roleCode))} role.
        Accepting adds staff access to this account; your existing records stay as they are.</p>
        <div class="button-row"><button class="button button-primary" type="button" data-appointment-respond="${esc(row.invitationId)}" data-accept="true">Accept appointment</button>
        <button class="button button-secondary" type="button" data-appointment-respond="${esc(row.invitationId)}" data-accept="false">Decline</button></div></article>`).join("")}</section>`;
  }
  function bind(root,{api,run}) {
    root.querySelectorAll("[data-appointment-respond]").forEach((button) => button.addEventListener("click",() => run(async () => {
      const accept = button.dataset.accept === "true";
      await api("POST",`/api/identity/staff-appointments/${button.dataset.appointmentRespond}`,{accept});
      return accept ? "Staff appointment accepted. Sign out and back in to use your staff access." : "Staff appointment declined.";
    })));
  }
  window.staffAppointmentsUI = {render,bind};
})();
