import test from "node:test";
import assert from "node:assert/strict";
import { registrationEligibility, validateMeetings } from "../server/modules/course-registration.js";

const context = () => ({
  today: "2026-10-02", programme: { status: "onboarded", programmeVersionId: "v1" },
  period: { status: "open", programmeVersionId: "v1", calendarStatus: "published", windows: { registration: ["2026-10-01","2026-10-30"] }, creditLimit: 30, startsOn: "2027-02-01" },
  offerings: [{ courseId: "c1", code: "COMP101", credits: 15, requirementType: "core", status: "active", effectiveFrom: "2026-01-01", delivery: "scheduled", meetings: [{ day: 1,start: 540,end: 600 }], prerequisites: [] },
    { courseId: "c2", code: "INFS101", credits: 15, requirementType: "core", status: "active", effectiveFrom: "2026-01-01", delivery: "scheduled", meetings: [{ day: 1,start: 600,end: 660 }], prerequisites: [] }],
  selectedCourses: ["c1","c2"], revision: 2, checks: ["academic","financial"].map((checkType) => ({ checkType,registrationRevision:2,outcome: "eligible",expiresOn: "2026-10-30",reason: "Pilot evidence" }))
});

test("registration explains missing core courses, credit limits, and timetable clashes", () => {
  assert.equal(registrationEligibility(context()).ready,true);
  const missing = context(); missing.selectedCourses = ["c1"];
  assert.ok(registrationEligibility(missing).blockers.some((item) => item.code === "CORE_COURSE"));
  const clash = context(); clash.offerings[1].meetings[0].start = 599; clash.period.creditLimit = 20;
  assert.deepEqual(registrationEligibility(clash).blockers.map((item) => item.code),["CREDIT_LIMIT","CLASH"]);
});

test("manual clearance cannot override closed windows or unknown prerequisite results", () => {
  const blocked = context(); blocked.period.status = "closed"; blocked.offerings[0].prerequisites = ["prior"];
  assert.deepEqual(registrationEligibility(blocked).blockers.map((item) => item.code),["WINDOW","PREREQUISITE_EVIDENCE"]);
  const mismatched = context(); mismatched.programme.programmeVersionId = "different"; mismatched.programme.status = "pending_onboarding";
  assert.deepEqual(registrationEligibility(mismatched).blockers.map((item) => item.code),["ONBOARDING","CURRICULUM_VERSION"]);
});

test("financial clearance, effective course dates, and duplicate enrolments fail closed", () => {
  const blocked = context(); blocked.checks = [{ checkType: "academic",registrationRevision:2,outcome: "eligible",expiresOn: "2026-10-01",reason: "Old" }]; blocked.existingCourses = ["c1"]; blocked.offerings[1].effectiveFrom = "2028-01-01";
  assert.deepEqual(registrationEligibility(blocked).blockers.map((item) => item.code),["ALREADY_ENROLLED","COURSE_STATUS","ACADEMIC_CLEARANCE","FINANCIAL_CLEARANCE"]);
});

test("course meetings require explicit delivery and valid ordered minute ranges", () => {
  assert.doesNotThrow(() => validateMeetings("asynchronous",[]));
  assert.doesNotThrow(() => validateMeetings("scheduled",[{ day: 7,start: 0,end: 1440 }]));
  for (const [delivery,meetings] of [["unknown",[]],["scheduled",[]],["asynchronous",[{day:1,start:0,end:60}]],["scheduled",[{day:0,start:0,end:60}]],["scheduled",[{day:1,start:60,end:60}]],["scheduled",[{day:1,start:0,end:1441}]]]) assert.throws(() => validateMeetings(delivery,meetings),{ statusCode: 400 });
  assert.throws(() => validateMeetings("scheduled",[{ day:1,start:540,end:600 },{ day:1,start:570,end:630 }]),{ statusCode:400 });
});

test("changing course selection invalidates both prior clearance decisions", () => {
  const changed = context(); changed.revision = 3;
  assert.deepEqual(registrationEligibility(changed).blockers.map((item) => item.code),["ACADEMIC_CLEARANCE","FINANCIAL_CLEARANCE"]);
  assert.ok(registrationEligibility(changed).blockers.every((item) => item.message.includes("older course selection")));
});

test("approved transfer dates prevent backdated destination enrolment even with clearance",() => {
  const current = context(); current.programme.transferEffectiveOn = "2027-02-01";
  assert.equal(registrationEligibility(current).ready,true);
  current.programme.transferEffectiveOn = "2027-02-02";
  assert.deepEqual(registrationEligibility(current).blockers.map((row) => row.code),["TRANSFER_CHRONOLOGY"]);
});

test("known prior enrolment needs repeat evidence even with generic academic clearance", () => {
  const repeat = context(); repeat.priorCourses = ["c1"];
  assert.deepEqual(registrationEligibility(repeat).blockers.map((item) => item.code),["REPEAT_EVIDENCE"]);
});
