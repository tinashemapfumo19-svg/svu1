import { randomUUID } from "node:crypto";
import {
  insertAudit,
  parseEffectiveDate,
  requestError,
  requireFields,
  withTransaction
} from "../support.js";

// Course catalogue and versioned curricula. Curricula belong to programme versions and can only be
// edited while that version is a draft; publishing checks prerequisite ordering and retired courses.

const termOrder = { S1: 1, S2: 2, S3: 3 };

const courseSelect = `select
  c.id,
  c.code,
  c.title,
  c.credits::float as credits,
  c.level,
  c.department_id as "departmentId",
  c.status,
  c.legacy_source_ref as "legacySourceRef",
  to_char(c.effective_from, 'YYYY-MM-DD') as "effectiveFrom",
  to_char(c.effective_to, 'YYYY-MM-DD') as "effectiveTo",
  coalesce(
    (select json_agg(p.code order by p.code)
     from course_prerequisites cp join courses p on p.id = cp.prerequisite_course_id
     where cp.course_id = c.id),
    '[]'::json
  ) as prerequisites
from courses c`;

export function assertCourseInput(input) {
  const problems = [];
  if (input.code !== undefined && !/^[A-Z]{2,5}\d{3,4}[A-Z]?$/.test(String(input.code))) {
    problems.push("code must look like COMP101 (2-5 letters, 3-4 digits, optional suffix letter)");
  }
  if (input.credits !== undefined) {
    const credits = Number(input.credits);
    if (!Number.isFinite(credits) || credits < 0.5 || credits > 60 || Math.round(credits * 2) !== credits * 2) {
      problems.push("credits must be between 0.5 and 60 in steps of 0.5");
    }
  }
  if (input.level !== undefined && !(Number.isInteger(input.level) && input.level >= 1 && input.level <= 8)) {
    problems.push("level must be a whole number from 1 to 8");
  }
  if (problems.length > 0) {
    throw requestError(400, `Course rejected: ${problems.join("; ")}.`);
  }
}

// edges: Map(courseId -> [prerequisiteIds]). Returns the cycle path if adding the edges creates one.
export function findPrerequisiteCycle(edges, startId) {
  const path = [];
  const visiting = new Set();
  const done = new Set();
  function visit(id) {
    if (visiting.has(id)) {
      return [...path.slice(path.indexOf(id)), id];
    }
    if (done.has(id)) {
      return null;
    }
    visiting.add(id);
    path.push(id);
    for (const next of edges.get(id) || []) {
      const cycle = visit(next);
      if (cycle) {
        return cycle;
      }
    }
    path.pop();
    visiting.delete(id);
    done.add(id);
    return null;
  }
  return visit(startId);
}

// entries: [{ courseId, code, yearOfStudy, term, status, prerequisites: [courseId] }]
export function curriculumProblems(entries) {
  const byCourse = new Map(entries.map((entry) => [entry.courseId, entry]));
  const problems = [];
  for (const entry of entries) {
    if (entry.legacySourceRef) {
      if (!['core','elective'].includes(entry.requirementType)) problems.push({course:entry.code,problem:'core/elective classification is not recorded'});
      if (!(entry.credits > 0)) problems.push({course:entry.code,problem:'course credits are not recorded'});
      if (!entry.effectiveFrom) problems.push({course:entry.code,problem:'course effective date is not recorded'});
      if (entry.status === 'draft') problems.push({course:entry.code,problem:'course catalogue details need completion'});
    }
    if (entry.status === "retired") {
      problems.push({ course: entry.code, problem: "course is retired" });
    }
    for (const prerequisiteId of entry.prerequisites || []) {
      const prerequisite = byCourse.get(prerequisiteId);
      if (!prerequisite) {
        problems.push({ course: entry.code, problem: `prerequisite ${prerequisiteId} is not in this curriculum` });
        continue;
      }
      if (entry.term === "ANY" || prerequisite.term === "ANY") {
        continue;
      }
      const entryPosition = entry.yearOfStudy * 10 + termOrder[entry.term];
      const prerequisitePosition = prerequisite.yearOfStudy * 10 + termOrder[prerequisite.term];
      if (prerequisitePosition >= entryPosition) {
        problems.push({ course: entry.code, problem: `prerequisite ${prerequisite.code} is not scheduled before it` });
      }
    }
  }
  return problems;
}

export async function loadCurriculum(db, versionId) {
  const result = await db.query(
    `select
      e.course_id as "courseId",
      c.code,
      c.title,
      c.credits::float as credits,
      c.status,
      e.year_of_study as "yearOfStudy",
      e.term,
      e.requirement_type as "requirementType",
      e.legacy_source_ref as "legacySourceRef",
      to_char(c.effective_from,'YYYY-MM-DD') as "effectiveFrom",
      coalesce(
        (select json_agg(cp.prerequisite_course_id) from course_prerequisites cp where cp.course_id = c.id),
        '[]'::json
      ) as prerequisites
     from curriculum_entries e
     join courses c on c.id = e.course_id
     where e.programme_version_id = $1
     order by e.year_of_study, e.term, c.code`,
    [versionId]
  );
  return result.rows;
}

export async function assertCurriculumPublishable(db, versionId) {
  const problems = curriculumProblems(await loadCurriculum(db, versionId));
  if (problems.length > 0) {
    throw requestError(409, `Curriculum is not publishable: ${problems.map((item) => `${item.course}: ${item.problem}`).join("; ")}.`);
  }
}

export function createCurriculumModule(pool) {
  return {
    async listCourses(filters = {}) {
      const values = [];
      const conditions = [];
      if (filters.departmentId) {
        values.push(filters.departmentId);
        conditions.push(`c.department_id = $${values.length}`);
      }
      if (filters.status) {
        values.push(filters.status);
        conditions.push(`c.status = $${values.length}`);
      }
      const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
      const result = await pool.query(`${courseSelect} ${where} order by c.code`, values);
      return result.rows;
    },

    async createCourse(input, actor) {
      requireFields(input, ["code", "title", "credits", "level", "departmentId"]);
      assertCourseInput(input);
      const id = input.id || `course_${randomUUID()}`;

      return withTransaction(pool, async (client) => {
        const department = await client.query(
          "select unit_type, status from organization_units where id = $1",
          [input.departmentId]
        );
        if (department.rowCount === 0 || department.rows[0].unit_type !== "department" || department.rows[0].status !== "active") {
          throw requestError(409, "Courses must be owned by an active department.");
        }
        const duplicate = await client.query("select 1 from courses where code = $1", [input.code]);
        if (duplicate.rowCount > 0) {
          throw requestError(409, `Course code ${input.code} already exists.`);
        }
        await client.query(
          `insert into courses (id, code, title, credits, level, department_id, status, effective_from, created_by)
           values ($1, $2, $3, $4, $5, $6, 'active', $7, $8)`,
          [id, input.code, input.title, input.credits, input.level, input.departmentId, parseEffectiveDate(input.effectiveFrom), actor.accountId]
        );
        const course = await findCourse(client, id);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.course.created",
          subjectType: "Course",
          subjectId: id,
          reason: input.reason || "Course created",
          metadata: { after: course }
        });
        return course;
      });
    },

    async updateCourse(courseId, input, actor) {
      requireFields(input, ["reason"]);
      if (input.code !== undefined) {
        throw requestError(400, "Course codes are immutable; create a new course instead.");
      }
      assertCourseInput(input);

      return withTransaction(pool, async (client) => {
        const before = await findCourse(client, courseId, { forUpdate: true });
        if (before.status === "retired") {
          throw requestError(409, "Retired courses cannot be changed.");
        }
        const changesCredits = input.credits !== undefined && Number(input.credits) !== before.credits;
        const changesLevel = input.level !== undefined && input.level !== before.level;
        if (changesCredits || changesLevel) {
          const published = await client.query(
            `select pv.version_label, p.code
             from curriculum_entries e
             join programme_versions pv on pv.id = e.programme_version_id
             join programmes p on p.id = pv.programme_id
             where e.course_id = $1 and pv.status in ('published', 'retired')
             limit 1`,
            [courseId]
          );
          if (published.rowCount > 0) {
            throw requestError(
              409,
              `Credits and level are fixed once a course is in a published curriculum (${published.rows[0].code} ${published.rows[0].version_label}); create a new course code instead.`
            );
          }
        }
        const effectiveFrom = input.effectiveFrom === undefined || input.effectiveFrom === '' ? before.effectiveFrom : parseEffectiveDate(input.effectiveFrom);
        if (input.effectiveFrom !== undefined && before.status !== 'draft') throw requestError(400,'Effective dates can only be completed on draft courses.');
        const credits = input.credits ?? before.credits, level = input.level ?? before.level;
        const status = before.status === 'draft' && credits > 0 && Number.isInteger(level) && level >= 1 && level <= 8 && effectiveFrom ? 'active' : before.status;
        await client.query(
          `update courses
           set title = $1, credits = $2, level = $3, effective_from=$5, status=$6, updated_at = now()
           where id = $4`,
          [input.title ?? before.title, credits, level, courseId, effectiveFrom, status]
        );
        const after = await findCourse(client, courseId);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.course.updated",
          subjectType: "Course",
          subjectId: courseId,
          reason: input.reason,
          metadata: { before, after }
        });
        return after;
      });
    },

    async retireCourse(courseId, input, actor) {
      requireFields(input, ["reason"]);

      return withTransaction(pool, async (client) => {
        const before = await findCourse(client, courseId, { forUpdate: true });
        if (before.status === "retired") {
          throw requestError(409, "Course is already retired.");
        }
        const drafts = await client.query(
          `select p.code, pv.version_label
           from curriculum_entries e
           join programme_versions pv on pv.id = e.programme_version_id
           join programmes p on p.id = pv.programme_id
           where e.course_id = $1 and pv.status = 'draft'`,
          [courseId]
        );
        if (drafts.rowCount > 0) {
          throw requestError(409, `Remove the course from draft curricula first: ${drafts.rows.map((row) => `${row.code} ${row.version_label}`).join(", ")}.`);
        }
        const dependants = await client.query(
          `select c.code from course_prerequisites cp
           join courses c on c.id = cp.course_id
           where cp.prerequisite_course_id = $1 and c.status = 'active'`,
          [courseId]
        );
        if (dependants.rowCount > 0) {
          throw requestError(409, `Active courses still require it: ${dependants.rows.map((row) => row.code).join(", ")}.`);
        }
        const effectiveTo = parseEffectiveDate(input.effectiveTo);
        await client.query(
          "update courses set status = 'retired', effective_to = $1, updated_at = now() where id = $2",
          [effectiveTo, courseId]
        );
        const after = await findCourse(client, courseId);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.course.retired",
          subjectType: "Course",
          subjectId: courseId,
          reason: input.reason,
          metadata: { before, after }
        });
        return after;
      });
    },

    async setCoursePrerequisites(courseId, input, actor) {
      requireFields(input, ["reason"]);
      if (!Array.isArray(input.prerequisiteCourseIds)) {
        throw requestError(400, "prerequisiteCourseIds must be an array of course ids.");
      }
      const requested = [...new Set(input.prerequisiteCourseIds)];
      if (requested.includes(courseId)) {
        throw requestError(400, "A course cannot be its own prerequisite.");
      }

      return withTransaction(pool, async (client) => {
        const before = await findCourse(client, courseId, { forUpdate: true });
        if (requested.length > 0) {
          const found = await client.query("select id, status from courses where id = any($1)", [requested]);
          if (found.rowCount !== requested.length) {
            throw requestError(404, "One or more prerequisite courses were not found.");
          }
          if (found.rows.some((row) => row.status !== "active")) {
            throw requestError(409, "Prerequisites must be active courses.");
          }
        }

        const graph = await client.query("select course_id, prerequisite_course_id from course_prerequisites where course_id <> $1", [courseId]);
        const edges = new Map([[courseId, requested]]);
        for (const row of graph.rows) {
          edges.set(row.course_id, [...(edges.get(row.course_id) || []), row.prerequisite_course_id]);
        }
        const cycle = findPrerequisiteCycle(edges, courseId);
        if (cycle) {
          const codes = await client.query("select id, code from courses where id = any($1)", [cycle]);
          const codeOf = new Map(codes.rows.map((row) => [row.id, row.code]));
          throw requestError(409, `Prerequisites would form a cycle: ${cycle.map((id) => codeOf.get(id)).join(" → ")}.`);
        }

        await client.query("delete from course_prerequisites where course_id = $1", [courseId]);
        for (const prerequisiteId of requested) {
          await client.query(
            "insert into course_prerequisites (course_id, prerequisite_course_id) values ($1, $2)",
            [courseId, prerequisiteId]
          );
        }
        const after = await findCourse(client, courseId);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.course.prerequisites_set",
          subjectType: "Course",
          subjectId: courseId,
          reason: input.reason,
          metadata: { before: before.prerequisites, after: after.prerequisites }
        });
        return after;
      });
    },

    async getCurriculum(versionId) {
      const version = await findVersion(pool, versionId);
      const entries = await loadCurriculum(pool, versionId);
      const creditsByYear = {};
      for (const entry of entries) {
        creditsByYear[entry.yearOfStudy] = (creditsByYear[entry.yearOfStudy] || 0) + entry.credits;
      }
      return { programmeVersion: version, entries, creditsByYear, problems: curriculumProblems(entries) };
    },

    async addCurriculumEntry(versionId, input, actor) {
      requireFields(input, ["courseId", "yearOfStudy", "term"]);
      const requirementType = input.requirementType || "core";
      if (!Number.isInteger(input.yearOfStudy) || input.yearOfStudy < 1 || input.yearOfStudy > 8) {
        throw requestError(400, "yearOfStudy must be a whole number from 1 to 8.");
      }
      if (!["S1", "S2", "S3", "ANY"].includes(input.term)) {
        throw requestError(400, "term must be S1, S2, S3, or ANY.");
      }
      if (!["core", "elective"].includes(requirementType)) {
        throw requestError(400, "requirementType must be core or elective.");
      }

      return withTransaction(pool, async (client) => {
        await assertDraftVersion(client, versionId);
        const course = await findCourse(client, input.courseId);
        if (course.status !== "active") {
          throw requestError(409, `${course.code} is ${course.status}.`);
        }
        const duplicate = await client.query(
          "select 1 from curriculum_entries where programme_version_id = $1 and course_id = $2",
          [versionId, input.courseId]
        );
        if (duplicate.rowCount > 0) {
          throw requestError(409, `${course.code} is already in this curriculum.`);
        }
        const id = `cur_${randomUUID()}`;
        await client.query(
          `insert into curriculum_entries (id, programme_version_id, course_id, year_of_study, term, requirement_type)
           values ($1, $2, $3, $4, $5, $6)`,
          [id, versionId, input.courseId, input.yearOfStudy, input.term, requirementType]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.curriculum.entry_added",
          subjectType: "ProgrammeVersion",
          subjectId: versionId,
          reason: input.reason || `Added ${course.code}`,
          afterRef: id,
          metadata: { course: course.code, yearOfStudy: input.yearOfStudy, term: input.term, requirementType }
        });
        return { id, courseId: input.courseId, code: course.code, yearOfStudy: input.yearOfStudy, term: input.term, requirementType };
      });
    },

    async removeCurriculumEntry(versionId, courseId, actor) {
      return withTransaction(pool, async (client) => {
        await assertDraftVersion(client, versionId);
        const removed = await client.query(
          "delete from curriculum_entries where programme_version_id = $1 and course_id = $2 returning id",
          [versionId, courseId]
        );
        if (removed.rowCount === 0) {
          throw requestError(404, "That course is not in this curriculum.");
        }
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.curriculum.entry_removed",
          subjectType: "ProgrammeVersion",
          subjectId: versionId,
          reason: `Removed course ${courseId}`,
          beforeRef: removed.rows[0].id
        });
        return { removed: courseId };
      });
    }
  };
}

async function findCourse(db, courseId, { forUpdate = false } = {}) {
  const result = await db.query(`${courseSelect} where c.id = $1 ${forUpdate ? "for update of c" : ""}`, [courseId]);
  if (result.rowCount === 0) {
    throw requestError(404, "Course was not found.");
  }
  return result.rows[0];
}

async function findVersion(db, versionId) {
  const result = await db.query(
    `select id, programme_id as "programmeId", version_label as "versionLabel", status from programme_versions where id = $1`,
    [versionId]
  );
  if (result.rowCount === 0) {
    throw requestError(404, "Programme version was not found.");
  }
  return result.rows[0];
}

async function assertDraftVersion(db, versionId) {
  const version = await findVersion(db, versionId);
  if (version.status !== "draft") {
    throw requestError(409, `The ${version.versionLabel} curriculum is ${version.status} and can no longer change; draft a new version.`);
  }
  return version;
}
