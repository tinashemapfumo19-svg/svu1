import { randomUUID } from "node:crypto";
import {
  assertActorCanAccessScope,
  actorCanAccessScope,
  getResourceScope,
  insertAudit,
  requestError,
  requireFields,
  withTransaction
} from "../support.js";

// Versioned, guarded workflows. Instances move only along transitions declared by their definition;
// a transition may require an extra permission (decision authority). Terminal states end the instance.

const instanceSelect = `select
  i.id,
  i.definition_id as "definitionId",
  d.code as "definitionCode",
  d.version as "definitionVersion",
  i.subject_type as "subjectType",
  i.subject_id as "subjectId",
  i.state,
  i.owner_account_id as "ownerAccountId",
  i.status,
  i.created_at as "createdAt",
  i.updated_at as "updatedAt"
from workflow_instances i
join workflow_definitions d on d.id = i.definition_id`;

export function isTerminalState(definition, state) {
  return (definition.terminalStates || []).includes(state);
}

export function allowedTransitionsFrom(definition, state, permissions = []) {
  if (isTerminalState(definition, state)) {
    return [];
  }
  return (definition.transitions || [])
    .filter((transition) => transition.from === state)
    .filter((transition) => !transition.permission || permissions.includes(transition.permission))
    .map((transition) => transition.to);
}

export function assertTransitionAllowed(definition, fromState, toState, permissions = []) {
  if (!definition.states.includes(toState)) {
    throw requestError(400, `${toState} is not a state in ${definition.code} v${definition.version}.`);
  }
  if (isTerminalState(definition, fromState)) {
    throw requestError(409, `The workflow is already in terminal state ${fromState}.`);
  }
  const transition = (definition.transitions || []).find((item) => item.from === fromState && item.to === toState);
  if (!transition) {
    throw requestError(409, `Cannot move from ${fromState} to ${toState}.`);
  }
  if (transition.permission && !permissions.includes(transition.permission)) {
    throw requestError(403, `Moving to ${toState} requires ${transition.permission}.`);
  }
  return transition;
}

export function createWorkflowModule(pool) {
  return {
    async listWorkflowDefinitions() {
      const result = await pool.query(`${definitionSelect} order by code, version desc`);
      return result.rows;
    },

    async listWorkflowInstances(actor) {
      const result = await pool.query(`select i.*, rs.id as "scopeId",
        rs.programme_code as "programmeCode", rs.intake_id as "intakeId"
        from (${instanceSelect}) i
        left join resource_scopes rs on rs.resource_type = i."subjectType" and rs.resource_id = i."subjectId"
        order by i.id`);
      return result.rows.filter(row => row.scopeId && actorCanAccessScope(actor, { programmeCode: row.programmeCode, intakeId: row.intakeId }))
        .map(({ scopeId, programmeCode, intakeId, ...row }) => row);
    },

    async getWorkflowInstance(instanceId, actor) {
      const instance = await findInstance(pool, instanceId);
      assertActorCanAccessScope(actor, await getResourceScope(pool, instance.subjectType, instance.subjectId));
      const definition = await findDefinition(pool, instance.definitionId);
      const history = await pool.query(
        `select occurred_at as "occurredAt", actor_id as "actorId", action, before_ref as "fromState", after_ref as "toState", reason
         from audit_events
         where subject_type = 'WorkflowInstance' and subject_id = $1
         order by occurred_at`,
        [instanceId]
      );
      return {
        ...instance,
        terminal: isTerminalState(definition, instance.state),
        allowedTransitions: allowedTransitionsFrom(definition, instance.state, actor.permissions),
        history: history.rows
      };
    },

    async createWorkflowInstance(input, actor) {
      requireFields(input, ["definitionCode", "subjectType", "subjectId"]);

      return withTransaction(pool, async (client) => {
        const definition = await findActiveDefinition(client, input.definitionCode);
        const existingScope = await client.query(
          `select programme_code as "programmeCode", intake_id as "intakeId"
           from resource_scopes where resource_type = $1 and resource_id = $2`,
          [input.subjectType, input.subjectId]
        );
        if (existingScope.rowCount > 0) {
          assertActorCanAccessScope(actor, existingScope.rows[0]);
        } else {
          if (!input.scope?.programmeCode) {
            throw requestError(400, "A new subject needs scope.programmeCode (and usually scope.intakeId).");
          }
          const scope = { programmeCode: input.scope.programmeCode, intakeId: input.scope.intakeId || null };
          assertActorCanAccessScope(actor, scope);
          await client.query(
            `insert into resource_scopes (id, resource_type, resource_id, programme_code, intake_id)
             values ($1, $2, $3, $4, $5)`,
            [`scope_${randomUUID()}`, input.subjectType, input.subjectId, scope.programmeCode, scope.intakeId]
          );
        }

        const open = await client.query(
          `select i.id, i.state from workflow_instances i
           join workflow_definitions d on d.id = i.definition_id
           where i.subject_type = $1 and i.subject_id = $2 and d.code = $3 and i.status = 'active'`,
          [input.subjectType, input.subjectId, definition.code]
        );
        if (open.rowCount > 0) {
          throw requestError(409, `${input.subjectType} ${input.subjectId} already has an active ${definition.code} workflow (${open.rows[0].id}).`);
        }

        const id = `wfi_${randomUUID()}`;
        await client.query(
          `insert into workflow_instances (id, definition_id, subject_type, subject_id, state, owner_account_id, status)
           values ($1, $2, $3, $4, $5, $6, 'active')`,
          [id, definition.id, input.subjectType, input.subjectId, definition.initialState, input.ownerAccountId || actor.accountId]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "workflow.instance.created",
          subjectType: "WorkflowInstance",
          subjectId: id,
          reason: input.reason || `Started ${definition.code} v${definition.version}`,
          afterRef: definition.initialState
        });
        return findInstance(client, id);
      });
    },

    async transitionWorkflow(instanceId, input, actor) {
      requireFields(input, ["toState", "reason"]);

      return withTransaction(pool, async (client) => {
        const current = await findInstance(client, instanceId, { forUpdate: true });
        assertActorCanAccessScope(actor, await getResourceScope(client, current.subjectType, current.subjectId));
        if (input.expectedState && input.expectedState !== current.state) {
          throw requestError(409, `The workflow moved to ${current.state} before this change was submitted.`);
        }
        const definition = await findDefinition(client, current.definitionId);
        assertTransitionAllowed(definition, current.state, input.toState, actor.permissions);
        if (current.subjectType === "Application" && ["Offer issued", "Rejected", "Accepted", "Declined", "Deferred", "Withdrawn", "Expired"].includes(input.toState)
            && (await client.query("select 1 from applications where id = $1", [current.subjectId])).rowCount) {
          throw requestError(409, "Use the admissions decision, offer-response, deferral, or withdrawal action so the application and its evidence stay consistent.");
        }

        const terminal = isTerminalState(definition, input.toState);
        await client.query(
          `update workflow_instances
           set state = $1, status = $2, updated_at = now()
           where id = $3`,
          [input.toState, terminal ? "completed" : "active", instanceId]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "workflow.transitioned",
          subjectType: "WorkflowInstance",
          subjectId: instanceId,
          reason: input.reason,
          beforeRef: current.state,
          afterRef: input.toState
        });
        return findInstance(client, instanceId);
      });
    }
  };
}

// Lets another module start a workflow inside its own transaction (for example, when an applicant
// submits). Moves still go through assertTransitionAllowed, so only declared transitions are possible.
export async function startWorkflowInTransaction(client, { definitionCode, subjectType, subjectId, ownerAccountId, actorId, reason, moveTo = [], permissions = [] }) {
  const definition = await findActiveDefinition(client, definitionCode);
  const id = `wfi_${randomUUID()}`;
  await client.query(
    `insert into workflow_instances (id, definition_id, subject_type, subject_id, state, owner_account_id, status)
     values ($1, $2, $3, $4, $5, $6, 'active')`,
    [id, definition.id, subjectType, subjectId, definition.initialState, ownerAccountId || null]
  );
  await insertAudit(client, {
    actorId,
    action: "workflow.instance.created",
    subjectType: "WorkflowInstance",
    subjectId: id,
    reason: reason || `Started ${definition.code} v${definition.version}`,
    afterRef: definition.initialState
  });
  let state = definition.initialState;
  for (const toState of moveTo) {
    assertTransitionAllowed(definition, state, toState, permissions);
    await client.query(
      "update workflow_instances set state = $1, status = $2, updated_at = now() where id = $3",
      [toState, isTerminalState(definition, toState) ? "completed" : "active", id]
    );
    await insertAudit(client, {
      actorId,
      action: "workflow.transitioned",
      subjectType: "WorkflowInstance",
      subjectId: id,
      reason: reason || `Moved to ${toState}`,
      beforeRef: state,
      afterRef: toState
    });
    state = toState;
  }
  return { id, state };
}

// Moves an existing instance on behalf of the system (e.g. an applicant withdrawing), still guarded.
export async function transitionWorkflowInTransaction(client, instanceId, { toState, actorId, reason, permissions = [] }) {
  const current = await findInstance(client, instanceId, { forUpdate: true });
  const definition = await findDefinition(client, current.definitionId);
  assertTransitionAllowed(definition, current.state, toState, permissions);
  await client.query(
    "update workflow_instances set state = $1, status = $2, updated_at = now() where id = $3",
    [toState, isTerminalState(definition, toState) ? "completed" : "active", instanceId]
  );
  await insertAudit(client, {
    actorId,
    action: "workflow.transitioned",
    subjectType: "WorkflowInstance",
    subjectId: instanceId,
    reason,
    beforeRef: current.state,
    afterRef: toState
  });
  return toState;
}

const definitionSelect = `select
  id,
  code,
  version,
  states,
  transitions,
  initial_state as "initialState",
  terminal_states as "terminalStates",
  active
from workflow_definitions`;

async function findDefinition(db, definitionId) {
  const result = await db.query(`${definitionSelect} where id = $1`, [definitionId]);
  if (result.rowCount === 0) {
    throw requestError(404, "Workflow definition was not found.");
  }
  return result.rows[0];
}

async function findActiveDefinition(db, code) {
  const result = await db.query(`${definitionSelect} where code = $1 and active order by version desc limit 1`, [code]);
  if (result.rowCount === 0) {
    throw requestError(404, `No active workflow definition ${code}.`);
  }
  if (!result.rows[0].initialState) {
    throw requestError(409, `Workflow definition ${code} has no initial state.`);
  }
  return result.rows[0];
}

async function findInstance(db, instanceId, { forUpdate = false } = {}) {
  const result = await db.query(
    `${instanceSelect} where i.id = $1 ${forUpdate ? "for update of i" : ""}`,
    [instanceId]
  );
  if (result.rowCount === 0) {
    throw requestError(404, "Workflow instance was not found.");
  }
  return result.rows[0];
}
