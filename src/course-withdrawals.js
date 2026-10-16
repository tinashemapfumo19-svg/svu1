(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const statusText = {requested:"awaiting approval",approved:"withdrawn",rejected:"not approved",cancelled:"cancelled"};
  // Course withdrawal for students (their own confirmed courses) and registry staff (request on behalf, independent review).
  function render(data,registrations) {
    if (!data) return "";
    const closed = new Set(data.requests.filter((row) => ["requested","approved"].includes(row.status)).map((row) => `${row.periodId}|${row.courseId}`));
    const options = (registrations || []).filter((row) => row.registration?.status === "confirmed").flatMap((row) => (row.registration.confirmation?.courses || [])
      .filter((course) => !closed.has(`${row.period.id}|${course.courseId}`)).map((course) => ({periodId:row.period.id,periodName:row.period.name,courseId:course.courseId,code:course.code})));
    return `<section class="course-withdrawals" data-course-withdrawals><h3>Course withdrawal</h3>
      ${data.requests.map((row) => `<article data-withdrawal="${row.id}"><p><strong>${esc(row.code)}</strong> ${esc(row.title)} - <span data-withdrawal-status="${esc(row.status)}">${esc(statusText[row.status])}</span> - ${esc(row.reason)}${row.reviewReason ? ` (${esc(row.reviewReason)})` : ""}</p>
        ${data.capabilities.approve && row.status === "requested" && row.requestedBy !== data.accountId ? `<form class="form form-grid" data-withdrawal-review="${row.id}"><label class="field"><span>Withdrawal decision</span><select class="input" name="outcome"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
          <label class="field"><span>Decision reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Record withdrawal decision</button></div></form>` : ""}</article>`).join("") || "<p>No withdrawal requests.</p>"}
      ${data.capabilities.request && options.length ? `<details><summary>Request withdrawal from a course</summary><form class="form form-grid" data-withdrawal-request>
        <label class="field"><span>Course</span><select class="input" name="target">${options.map((row) => `<option value="${esc(row.periodId)}|${esc(row.courseId)}">${esc(row.code)} - ${esc(row.periodName)}</option>`).join("")}</select></label>
        <label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label><label class="field"><span>Evidence (optional)</span><input class="input" name="evidenceRef" maxlength="300"></label>
        <p class="muted">Withdrawal is not possible once results exist for the course. Any fee change is handled separately by finance.</p>
        <div><button class="button button-secondary" type="submit">Request withdrawal</button></div></form></details>` : ""}
    </section>`;
  }
  function bind(root,{api,run,programmeId,own}) {
    const base = `/api/registry/${own ? "me/" : ""}programmes/${programmeId}`;
    root.querySelector("[data-withdrawal-request]")?.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)),[periodId,courseId] = values.target.split("|");
      run(async () => {await api("POST",`${base}/registrations/${periodId}/withdrawals`,{courseId,reason:values.reason,...(values.evidenceRef ? {evidenceRef:values.evidenceRef} : {})}); return "Withdrawal requested for independent approval.";});
    });
    root.querySelectorAll("[data-withdrawal-review]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      run(async () => {await api("POST",`/api/registry/programmes/${programmeId}/withdrawals/${form.dataset.withdrawalReview}/review`,values); return values.outcome === "approved" ? "Course withdrawal approved." : "Course withdrawal rejected.";});
    }));
  }
  window.courseWithdrawalsUI = {render,bind};
})();
