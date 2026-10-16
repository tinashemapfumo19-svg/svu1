import test from "node:test";
import assert from "node:assert/strict";
import { validateStudentProfile, onboardingReadiness } from "../server/modules/registry.js";

const profile = () => ({ revision: 0, phone: "+263771234567", address: { line1: "1 Main Street", city: "Harare", countryCode: "ZW" }, nextOfKin: { name: "Emergency Contact", relationship: "parent", phone: "+263771234568" } });

test("student onboarding validates contact data without enabling restricted medical fields", () => {
  assert.equal(onboardingReadiness(validateStudentProfile(profile())).complete, true);
  for (const change of [{ phone: "123" }, { revision: -1 }, { revision: "1" }, { religion: "private" }, { medicalCondition: "private" }, { address: null }, { nextOfKin: { name: "Contact", relationship: "unknown", phone: "+263771234568" } }]) {
    assert.throws(() => validateStudentProfile({ ...profile(), ...change }), { statusCode: 400 });
  }
});

test("saved onboarding drafts cannot be approved without an emergency contact", () => {
  const draft = { ...profile(), nextOfKin: {} };
  assert.doesNotThrow(() => validateStudentProfile(draft));
  assert.deepEqual(onboardingReadiness(draft), { complete: false, missing: ["nextOfKin"] });
  assert.deepEqual(onboardingReadiness(null).missing, ["phone", "address", "nextOfKin"]);
});
