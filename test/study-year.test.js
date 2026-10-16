import test from "node:test";
import assert from "node:assert/strict";
import { studyYearState, withStudyYear } from "../server/modules/study-year.js";

const registration = (overrides = {}) => ({registrationId:"reg1",referenceNumber:"REG-2025-1",academicPeriodId:"ap1",programmeVersionId:"v1",
  periodName:"First semester",startsOn:"2025-02-01",endsOn:"2025-06-30",yearOfStudy:1,term:"S1",confirmedAt:"2025-01-20T10:00:00.000Z",...overrides});
const progressed = (overrides = {}) => registration({registrationId:"reg2",referenceNumber:"REG-2026-2",academicPeriodId:"ap2",yearOfStudy:2,
  startsOn:"2026-02-01",endsOn:"2026-06-30",confirmedAt:"2026-01-20T10:00:00.000Z",
  progression:{id:12,kind:"progression",status:"approved",policyId:"acp1",evidenceHash:"a".repeat(64),reason:"PRIVATE",sourceSnapshot:{secret:true}},...overrides});

test("study year has no admission, intake-date, draft, or course-selection default",() => {
  assert.equal(studyYearState([],"onboarded","2026-10-02").state,"not_registered");
  assert.equal(studyYearState([],"pending_onboarding","2026-10-02").yearOfStudy,null);
});
test("confirmed upcoming years activate on their UTC period start, not early registration",() => {
  const rows = [registration(),progressed()];
  const before = studyYearState(rows,"onboarded","2026-01-31");
  assert.equal(before.yearOfStudy,1); assert.equal(before.upcoming[0].yearOfStudy,2);
  const during = studyYearState(rows,"onboarded","2026-02-01");
  assert.equal(during.yearOfStudy,2); assert.equal(during.source.progressionDecisionId,12);
  assert.equal(during.currentPeriods.length,1);
  assert.equal(studyYearState(rows,"onboarded","2026-06-30").currentPeriods.length,1);
  assert.equal(studyYearState(rows,"onboarded","2026-07-01").currentPeriods.length,0);
  assert.equal(studyYearState(rows,"onboarded","2026-07-01").yearOfStudy,2);
  const early = studyYearState([progressed()],"onboarded","2026-01-25");
  assert.equal(early.state,"scheduled"); assert.equal(early.yearOfStudy,null);
});
test("receipt history stays stable and repeat enrolment cannot demote the recorded level",() => {
  const repeat = registration({registrationId:"reg3",startsOn:"2026-07-01",endsOn:"2026-12-31",term:"S3",confirmedAt:"2026-06-20T10:00:00.000Z"});
  const rows = [repeat,progressed(),registration()],copy = structuredClone(rows);
  const state = studyYearState(rows,"onboarded","2026-10-02");
  assert.equal(state.yearOfStudy,2); assert.equal(state.currentPeriods[0].yearOfStudy,1);
  assert.deepEqual(rows,copy);
  assert.deepEqual(state,studyYearState([...rows].reverse(),"onboarded","2026-10-02"));
  assert.ok(!JSON.stringify(state).includes("PRIVATE")); assert.ok(!JSON.stringify(state).includes("secret"));
});
test("inactive programme history is retained but cannot assert active enrolment",() => {
  for (const status of ["suspended","interrupted","withdrawn","transferred","completed"]) {
    const state = studyYearState([progressed()],status,"2026-03-01");
    assert.equal(state.active,false); assert.equal(state.yearOfStudy,2); assert.deepEqual(state.currentPeriods,[]);
  }
});
test("incomplete legacy or unapproved higher-level receipts fail closed without live-data inference",() => {
  for (const row of [registration({startsOn:null}),registration({startsOn:"2025-02-30"}),registration({confirmedAt:123}),registration({term:"T1"}),
    progressed({progression:null}),progressed({progression:{id:12,status:"requested"}}),registration({yearOfStudy:9})]) {
    const state = studyYearState([registration(),{...row,registrationId:"bad"}],"onboarded","2026-10-02");
    assert.equal(state.state,"reconciliation_required"); assert.equal(state.yearOfStudy,null); assert.equal(state.source,null);
    assert.deepEqual(state.unresolvedRegistrationIds,["bad"]);
  }
  assert.throws(() => studyYearState([],"onboarded","2026-02-30"),TypeError);
});
test("registry projection never carries a source programme level into another pinned curriculum",() => {
  const row = {id:"sp1",status:"onboarded",programmeVersionId:"v2",studyYearRegistrations:[registration()]};
  const state = withStudyYear(row);
  assert.equal(state.studyYear.state,"reconciliation_required");
  assert.ok(!Object.hasOwn(state,"studyYearRegistrations"));
  assert.equal(withStudyYear({...row,studyYearRegistrations:[]}).studyYear.yearOfStudy,null);
});
