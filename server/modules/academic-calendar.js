import { randomUUID } from "node:crypto";
import {
  insertAudit,
  parseEffectiveDate,
  requestError,
  requireFields,
  withTransaction
} from "../support.js";

// Academic years contain semesters/terms. Each period carries named date windows that later
// modules (admissions, registration, assessment, results) use to decide what is open on a date.

export const periodTypes = ["academic_year", "semester", "term"];
export const windowNames = ["application", "registration", "teaching", "assessment", "results_publication", "archive"];
const windowsInsidePeriod = ["teaching", "assessment"];

const periodTransitions = {
  planning: ["published"],
  published: ["planning", "active"],
  active: ["closed"],
  closed: ["archived"],
  archived: []
};

const periodSelect = `select
  id,
  code,
  name,
  period_type as "periodType",
  parent_id as "parentId",
  to_char(starts_on, 'YYYY-MM-DD') as "startsOn",
  to_char(ends_on, 'YYYY-MM-DD') as "endsOn",
  lifecycle_status as "lifecycleStatus",
  windows
from academic_periods`;

export function canTransitionPeriod(fromStatus, toStatus) {
  return (periodTransitions[fromStatus] || []).includes(toStatus);
}

export function validateWindows(windows, startsOn, endsOn) {
  if (windows === null || typeof windows !== "object" || Array.isArray(windows)) {
    throw requestError(400, "Windows must be an object keyed by window name.");
  }
  const normalized = {};
  for (const [name, range] of Object.entries(windows)) {
    if (!windowNames.includes(name)) {
      throw requestError(400, `Unknown window ${name}; use ${windowNames.join(", ")}.`);
    }
    if (!Array.isArray(range) || range.length !== 2) {
      throw requestError(400, `Window ${name} must be [startDate, endDate].`);
    }
    const [start, end] = range.map((value) => parseEffectiveDate(value));
    if (start > end) {
      throw requestError(400, `Window ${name} starts after it ends.`);
    }
    if (windowsInsidePeriod.includes(name) && (start < startsOn || end > endsOn)) {
      throw requestError(400, `Window ${name} must fall within the period ${startsOn} to ${endsOn}.`);
    }
    normalized[name] = [start, end];
  }
  return normalized;
}

export function openWindowsOn(period, date) {
  return Object.entries(period.windows || {})
    .filter(([, [start, end]]) => start <= date && date <= end)
    .map(([name]) => name);
}

export function createAcademicCalendarModule(pool) {
  return {
    async listAcademicPeriods(filters = {}) {
      const asOf = parseEffectiveDate(filters.asOf);
      const values = [];
      const conditions = [];
      if (filters.periodType) {
        values.push(filters.periodType);
        conditions.push(`period_type = $${values.length}`);
      }
      if (filters.status) {
        values.push(filters.status);
        conditions.push(`lifecycle_status = $${values.length}`);
      }
      const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
      const result = await pool.query(`${periodSelect} ${where} order by starts_on, period_type, code`, values);
      return {
        asOf,
        data: result.rows.map((period) => ({
          ...period,
          containsDate: period.startsOn <= asOf && asOf <= period.endsOn,
          openWindows: period.lifecycleStatus === "planning" ? [] : openWindowsOn(period, asOf)
        }))
      };
    },

    async createAcademicPeriod(input, actor) {
      requireFields(input, ["code", "name", "periodType", "startsOn", "endsOn"]);
      if (!periodTypes.includes(input.periodType)) {
        throw requestError(400, `Period type must be one of ${periodTypes.join(", ")}.`);
      }
      const startsOn = parseEffectiveDate(input.startsOn);
      const endsOn = parseEffectiveDate(input.endsOn);
      if (startsOn >= endsOn) {
        throw requestError(400, "A period must start before it ends.");
      }
      const windows = validateWindows(input.windows || {}, startsOn, endsOn);
      const id = input.id || `period_${randomUUID()}`;

      return withTransaction(pool, async (client) => {
        const duplicate = await client.query("select 1 from academic_periods where code = $1", [input.code]);
        if (duplicate.rowCount > 0) {
          throw requestError(409, `Academic period code ${input.code} already exists.`);
        }
        const parentId = await assertPlacement(client, {
          id,
          periodType: input.periodType,
          parentId: input.parentId,
          startsOn,
          endsOn
        });
        await client.query(
          `insert into academic_periods (id, code, name, period_type, parent_id, starts_on, ends_on, lifecycle_status, windows, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, 'planning', $8, $9)`,
          [id, input.code, input.name, input.periodType, parentId, startsOn, endsOn, windows, actor.accountId]
        );
        const period = await findPeriod(client, id);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.academic_period.created",
          subjectType: "AcademicPeriod",
          subjectId: id,
          reason: input.reason || "Academic period created",
          metadata: { after: period }
        });
        return period;
      });
    },

    async updateAcademicPeriod(periodId, input, actor) {
      requireFields(input, ["reason"]);

      return withTransaction(pool, async (client) => {
        const before = await findPeriod(client, periodId, { forUpdate: true });
        const changesDates = input.startsOn !== undefined || input.endsOn !== undefined;
        if (["closed", "archived"].includes(before.lifecycleStatus)) {
          throw requestError(409, `A ${before.lifecycleStatus} period cannot be changed.`);
        }
        if (before.lifecycleStatus === "active" && (changesDates || input.name !== undefined)) {
          throw requestError(409, "An active period only accepts window changes.");
        }

        const startsOn = input.startsOn === undefined ? before.startsOn : parseEffectiveDate(input.startsOn);
        const endsOn = input.endsOn === undefined ? before.endsOn : parseEffectiveDate(input.endsOn);
        if ((startsOn !== before.startsOn || endsOn !== before.endsOn)
          && (await client.query("select 1 from course_enrolments where academic_period_id = $1 limit 1",[periodId])).rowCount) {
          throw requestError(409,"Dates supporting confirmed course enrolments are immutable; use a separately governed correction workflow.");
        }
        if (startsOn >= endsOn) {
          throw requestError(400, "A period must start before it ends.");
        }
        const windows = validateWindows(input.windows === undefined ? before.windows : input.windows, startsOn, endsOn);
        if (changesDates) {
          await assertPlacement(client, { ...before, startsOn, endsOn });
          await assertChildrenInside(client, periodId, startsOn, endsOn);
        }

        await client.query(
          `update academic_periods
           set name = $1, starts_on = $2, ends_on = $3, windows = $4, updated_at = now()
           where id = $5`,
          [input.name === undefined ? before.name : input.name, startsOn, endsOn, windows, periodId]
        );
        const after = await findPeriod(client, periodId);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.academic_period.updated",
          subjectType: "AcademicPeriod",
          subjectId: periodId,
          reason: input.reason,
          metadata: { before, after }
        });
        return after;
      });
    },

    async transitionAcademicPeriod(periodId, input, actor) {
      requireFields(input, ["toStatus", "reason"]);

      return withTransaction(pool, async (client) => {
        const before = await findPeriod(client, periodId, { forUpdate: true });
        if (!canTransitionPeriod(before.lifecycleStatus, input.toStatus)) {
          throw requestError(409, `Cannot move a period from ${before.lifecycleStatus} to ${input.toStatus}.`);
        }
        if (input.toStatus === "active" && before.parentId) {
          const parent = await findPeriod(client, before.parentId);
          if (!["published", "active"].includes(parent.lifecycleStatus)) {
            throw requestError(409, "Publish the academic year before activating its terms.");
          }
        }
        if (["closed", "archived"].includes(input.toStatus)) {
          const openChildren = await client.query(
            `select code from academic_periods
             where parent_id = $1 and lifecycle_status not in ('closed', 'archived')`,
            [periodId]
          );
          if (openChildren.rowCount > 0) {
            throw requestError(409, `Close child periods first: ${openChildren.rows.map((row) => row.code).join(", ")}.`);
          }
        }

        await client.query(
          "update academic_periods set lifecycle_status = $1, updated_at = now() where id = $2",
          [input.toStatus, periodId]
        );
        const after = await findPeriod(client, periodId);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: `master_data.academic_period.${input.toStatus}`,
          subjectType: "AcademicPeriod",
          subjectId: periodId,
          reason: input.reason,
          beforeRef: before.lifecycleStatus,
          afterRef: after.lifecycleStatus,
          metadata: { before, after }
        });
        return after;
      });
    }
  };
}

async function findPeriod(db, periodId, { forUpdate = false } = {}) {
  const result = await db.query(`${periodSelect} where id = $1 ${forUpdate ? "for update" : ""}`, [periodId]);
  if (result.rowCount === 0) {
    throw requestError(404, "Academic period was not found.");
  }
  return result.rows[0];
}

// Academic years are top-level and may not overlap; semesters/terms sit inside one year and may
// not overlap siblings of the same type.
async function assertPlacement(db, period) {
  let parentId = null;
  if (period.periodType === "academic_year") {
    if (period.parentId) {
      throw requestError(400, "Academic years are top-level periods.");
    }
  } else {
    if (!period.parentId) {
      throw requestError(400, "Semesters and terms must belong to an academic year.");
    }
    const parent = await findPeriod(db, period.parentId);
    if (parent.periodType !== "academic_year") {
      throw requestError(409, "The parent period must be an academic year.");
    }
    if (["closed", "archived"].includes(parent.lifecycleStatus)) {
      throw requestError(409, `The academic year is ${parent.lifecycleStatus}.`);
    }
    if (period.startsOn < parent.startsOn || period.endsOn > parent.endsOn) {
      throw requestError(400, `The period must fall within ${parent.code} (${parent.startsOn} to ${parent.endsOn}).`);
    }
    parentId = parent.id;
  }

  const overlap = await db.query(
    `select code from academic_periods
     where id <> $1
       and period_type = $2
       and parent_id is not distinct from $3
       and starts_on <= $5::date
       and ends_on >= $4::date
     limit 1`,
    [period.id, period.periodType, parentId, period.startsOn, period.endsOn]
  );
  if (overlap.rowCount > 0) {
    throw requestError(409, `The period overlaps ${overlap.rows[0].code}.`);
  }
  return parentId;
}

async function assertChildrenInside(db, periodId, startsOn, endsOn) {
  const outside = await db.query(
    `select code from academic_periods
     where parent_id = $1 and (starts_on < $2::date or ends_on > $3::date)`,
    [periodId, startsOn, endsOn]
  );
  if (outside.rowCount > 0) {
    throw requestError(409, `Child periods would fall outside the new dates: ${outside.rows.map((row) => row.code).join(", ")}.`);
  }
}
