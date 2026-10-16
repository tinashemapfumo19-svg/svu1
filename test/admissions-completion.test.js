import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { admissionsDefinition, requiredDocuments, validateAdmissionsRequirements } from "../server/modules/admissions-routing.js";
import { validateAdmissionsExport } from "../server/modules/admissions-migration.js";
import { allowedTransitionsFrom } from "../server/modules/workflow.js";

test("postgraduate routes preserve decision authority and cannot skip faculty assessment", () => {
  const definition = admissionsDefinition("admissions_postgraduate", 1, ["Academic review", "Faculty review"]);
  assert.deepEqual(allowedTransitionsFrom(definition, "Academic review"), ["Faculty review", "Information requested", "Withdrawn"]);
  assert.deepEqual(allowedTransitionsFrom(definition, "Decision"), ["Withdrawn"]);
  assert.ok(allowedTransitionsFrom(definition, "Decision", ["admissions.decide"]).includes("Deferred"));
  assert.throws(() => admissionsDefinition("invalid", 1, ["Academic review", "Decision"]));
  assert.throws(() => admissionsDefinition("invalid", 1, ["Academic review", "Academic review"]));
});

test("category checklists combine base and category requirements without duplicates", () => {
  const requirements = { documents: ["national_id"], documentsByCategory: { international: ["national_id", "passport"] } };
  validateAdmissionsRequirements(requirements);
  assert.deepEqual(requiredDocuments({ requirements, answers: { applicantCategory: "international" } }), ["national_id", "passport"]);
  assert.deepEqual(requiredDocuments({ requirements }), ["national_id"]);
  assert.throws(() => validateAdmissionsRequirements({ documentsByCategory: { international: "passport" } }));
  for (const value of [{unknown:true},{documents:['passport','passport']},{documentsByCategory:{standard:['passport']}},{documentsByCategory:{constructor:[]}},{documentsByCategory:Object.fromEntries(Array.from({length:21},(_,i)=>[`category_${i}`,[]]))}]) assert.throws(()=>validateAdmissionsRequirements(value),{statusCode:400});
});

test("admissions exports refuse mismatched control totals, checksums, duplicate IDs, and disguised files", () => {
  const bytes = Buffer.from("%PDF-1.4\n%%EOF\n");
  const sample = {
    source: "sample", totals: { applications: 1, documents: 1, documentBytes: bytes.length },
    applications: [{ legacyId: "A1", accountId: "mapped-account", intakeId: "mapped-intake", state: "Submitted",
      documents: [{ legacyId: "D1", documentType: "national_id", fileName: "id.pdf", contentType: "application/pdf", contentBase64: bytes.toString("base64"), checksum: createHash("sha256").update(bytes).digest("hex") }] }]
  };
  assert.deepEqual(validateAdmissionsExport(sample), sample.totals);
  assert.throws(() => validateAdmissionsExport({ ...sample, totals: { ...sample.totals, documents: 2 } }));
  const corrupt = structuredClone(sample);
  corrupt.applications[0].documents[0].checksum = "0".repeat(64);
  assert.throws(() => validateAdmissionsExport(corrupt));
  const duplicate = structuredClone(sample);
  duplicate.applications.push(duplicate.applications[0]);
  assert.throws(() => validateAdmissionsExport(duplicate));
  const disguised = structuredClone(sample);
  const executable = Buffer.from("MZfake executable");
  disguised.applications[0].documents[0].contentBase64 = executable.toString("base64");
  disguised.applications[0].documents[0].checksum = createHash("sha256").update(executable).digest("hex");
  disguised.totals.documentBytes = executable.length;
  assert.throws(() => validateAdmissionsExport(disguised));
});
