// Canonical versioned workflow definitions. A published version is immutable: change behaviour by
// adding a new version, never by editing an existing one. Loaded idempotently by `npm run reference:load`
// and the dev seed.

import { admissionsDefinition } from "../server/modules/admissions-routing.js";

const withdrawable = [
  "Draft",
  "Submitted",
  "Payment verified",
  "Completeness review",
  "Information requested",
  "Academic review",
  "Decision",
  "Offer issued"
];

export const workflowDefinitions = [
  {
    id: "wf_admissions_v2",
    code: "admissions_application",
    version: 2,
    initialState: "Draft",
    terminalStates: ["Rejected", "Accepted", "Declined", "Deferred", "Withdrawn", "Expired"],
    states: [
      "Draft",
      "Submitted",
      "Payment verified",
      "Completeness review",
      "Information requested",
      "Academic review",
      "Decision",
      "Offer issued",
      "Rejected",
      "Accepted",
      "Declined",
      "Deferred",
      "Withdrawn",
      "Expired"
    ],
    transitions: [
      { from: "Draft", to: "Submitted" },
      { from: "Submitted", to: "Payment verified" },
      { from: "Payment verified", to: "Completeness review" },
      { from: "Completeness review", to: "Information requested" },
      { from: "Information requested", to: "Completeness review" },
      { from: "Completeness review", to: "Academic review" },
      { from: "Academic review", to: "Information requested" },
      { from: "Academic review", to: "Decision" },
      { from: "Decision", to: "Offer issued", permission: "admissions.decide" },
      { from: "Decision", to: "Rejected", permission: "admissions.decide" },
      { from: "Offer issued", to: "Accepted" },
      { from: "Offer issued", to: "Declined" },
      { from: "Offer issued", to: "Deferred", permission: "admissions.decide" },
      { from: "Offer issued", to: "Expired" },
      ...withdrawable.map((from) => ({ from, to: "Withdrawn" }))
    ]
  }
];

export async function loadWorkflowDefinitions(db) {
  let inserted = 0;
  for (const definition of workflowDefinitions) {
    const result = await db.query(
      `insert into workflow_definitions (id, code, version, states, transitions, initial_state, terminal_states, active)
       values ($1, $2, $3, $4, $5, $6, $7, true)
       on conflict (id) do nothing`,
      [
        definition.id,
        definition.code,
        definition.version,
        JSON.stringify(definition.states),
        JSON.stringify(definition.transitions),
        definition.initialState,
        JSON.stringify(definition.terminalStates)
      ]
    );
    inserted += result.rowCount;
    await db.query(
      "update workflow_definitions set active = false where code = $1 and version < $2 and active",
      [definition.code, definition.version]
    );
  }
  return inserted;
}

workflowDefinitions.push(
  admissionsDefinition("admissions_application", 3),
  admissionsDefinition("admissions_postgraduate", 1, ["Academic review", "Faculty review"])
);
