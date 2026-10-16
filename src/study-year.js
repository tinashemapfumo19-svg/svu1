window.studyYearUI = (() => {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function render(programme) {
    const state = programme.studyYear;
    if (!state) return "";
    const label = state.state === "reconciliation_required" ? "Reconciliation required" : state.yearOfStudy ? `Year ${state.yearOfStudy}` : state.state === "scheduled" ? "Scheduled" : "Not registered";
    const period = (row) => `<li><strong>Year ${row.yearOfStudy} - ${esc(row.term)}</strong> - ${esc(row.periodName)}<br>${esc(row.startsOn)} to ${esc(row.endsOn)} - ${esc(row.referenceNumber)}${row.progressionDecisionId ? ` - Progression #${esc(row.progressionDecisionId)}` : ""}</li>`;
    return `<section class="study-year" data-study-year><h3>Study year</h3><p data-study-year-level>${label}${!state.active ? ` - ${esc(programme.status.replaceAll("_"," "))}` : ""}</p>
      ${state.source ? `<p>As of ${esc(state.asOf)} - ${esc(state.source.referenceNumber)}</p>` : ""}
      ${state.currentPeriods.length ? `<h4>Current enrolment</h4><ul>${state.currentPeriods.map(period).join("")}</ul>` : ""}
      ${state.upcoming.length ? `<h4>Upcoming enrolment</h4><ul>${state.upcoming.map(period).join("")}</ul>` : ""}
      ${state.history.length ? `<details><summary>Study-year history (${state.history.length})</summary><ul>${state.history.map(period).join("")}</ul></details>` : ""}
      ${state.unresolvedRegistrationIds.length ? `<p>${state.unresolvedRegistrationIds.length} confirmed records need reconciliation.</p>` : ""}</section>`;
  }
  return {render};
})();
