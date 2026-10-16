import { randomUUID } from "node:crypto";
import {
  assertSeparateApprover,
  insertAudit,
  parseEffectiveDate,
  requestError,
  requireFields,
  withTransaction
} from "../support.js";

// Versioned grading schemes (mark bands -> grade/points, GPA -> classification) and GPA rule sets
// (credit weighting, retakes, exclusions, rounding). A rule set publishes only when every stored
// worked example reproduces its expected GPA and classification.

// ---------- pure rules ----------

export function assertGradingScheme(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw requestError(400,'Provide a grading scheme.');
  const {bands,classifications}=input;
  if (!Array.isArray(bands) || bands.length>101 || bands.some(b=>!b || typeof b!=='object' || !Number.isFinite(b.points) || typeof b.passing!=='boolean' || typeof b.grade!=='string' || !b.grade.trim() || b.grade.length>20)
    || !Array.isArray(classifications) || classifications.length>100 || classifications.some(c=>!c || typeof c!=='object' || !Number.isFinite(c.minGpa) || typeof c.label!=='string' || !c.label.trim() || c.label.length>200)) throw requestError(400,'Provide bounded mark bands and classifications with valid grades, points and passing states.');
  const problems = [];
  if (!Array.isArray(bands) || bands.length === 0) {
    problems.push("bands must be a non-empty array");
  } else {
    const sorted = [...bands].sort((a, b) => a.minMark - b.minMark);
    if (sorted[0].minMark !== 0) {
      problems.push("bands must start at mark 0");
    }
    if (sorted.at(-1).maxMark !== 100) {
      problems.push("bands must end at mark 100");
    }
    const grades = new Set();
    for (const [index, band] of sorted.entries()) {
      if (!Number.isInteger(band.minMark) || !Number.isInteger(band.maxMark) || band.minMark > band.maxMark) {
        problems.push(`band ${band.grade} needs whole-number minMark <= maxMark`);
      }
      if (index > 0 && band.minMark !== sorted[index - 1].maxMark + 1) {
        problems.push(`band ${band.grade} must start right after ${sorted[index - 1].grade} (gap or overlap)`);
      }
      if (index > 0 && band.points < sorted[index - 1].points) {
        problems.push(`band ${band.grade} awards fewer points than a lower band`);
      }
      if (index > 0 && sorted[index - 1].passing && !band.passing) {
        problems.push(`band ${band.grade} fails while a lower band passes`);
      }
      if (typeof band.points !== "number" || band.points < 0) {
        problems.push(`band ${band.grade} needs non-negative points`);
      }
      if (!band.grade || grades.has(band.grade)) {
        problems.push(`band grades must be present and unique (${band.grade})`);
      }
      grades.add(band.grade);
    }
    if (!sorted.some((band) => band.passing)) {
      problems.push("at least one band must pass");
    }
  }
  if (!Array.isArray(classifications) || classifications.length === 0) {
    problems.push("classifications must be a non-empty array");
  } else {
    const thresholds = classifications.map((item) => item.minGpa);
    if (thresholds.some((value) => typeof value !== "number" || value < 0)) {
      problems.push("classification minGpa values must be non-negative numbers");
    }
    if (new Set(thresholds).size !== thresholds.length) {
      problems.push("classification thresholds must be unique");
    }
  }
  if (problems.length > 0) {
    throw requestError(400, `Grading scheme rejected: ${problems.join("; ")}.`);
  }
}

export function assertGpaRules(rules) {
  if (!rules || typeof rules!=='object' || Array.isArray(rules)) throw requestError(400,'Provide GPA rules.');
  const problems = [];
  if (typeof rules.creditWeighted !== "boolean") {
    problems.push("creditWeighted must be true or false");
  }
  if (!["latest", "best", "all"].includes(rules.retakePolicy)) {
    problems.push("retakePolicy must be latest, best, or all");
  }
  if (!Array.isArray(rules.excludeGrades) || rules.excludeGrades.length>100 || rules.excludeGrades.some(g=>typeof g!=='string' || !g.trim() || g.length>20)) {
    problems.push("excludeGrades must be an array of grade codes such as W or EX");
  }
  if (typeof rules.includeFailed !== "boolean") {
    problems.push("includeFailed must be true or false");
  }
  const rounding = rules.rounding || {};
  if (!Number.isInteger(rounding.decimals) || rounding.decimals < 0 || rounding.decimals > 4) {
    problems.push("rounding.decimals must be 0-4");
  }
  if (!["half_up", "truncate"].includes(rounding.mode)) {
    problems.push("rounding.mode must be half_up or truncate");
  }
  if (problems.length > 0) {
    throw requestError(400, `GPA rules rejected: ${problems.join("; ")}.`);
  }
}

export function assertGpaResults(results) {
  if (!Array.isArray(results) || results.length>100) throw requestError(400,'Provide up to 100 worked-example results.');
  const attempts=new Set();
  for (const result of results) {
    if (!result || typeof result!=='object' || Array.isArray(result) || Object.keys(result).some(k=>!['courseCode','credits','mark','grade','attempt'].includes(k))
      || typeof result.courseCode!=='string' || !result.courseCode.trim() || result.courseCode.length>100 || !Number.isFinite(result.credits) || result.credits<=0 || result.credits>1000
      || result.attempt!==undefined && (!Number.isInteger(result.attempt) || result.attempt<1 || result.attempt>100)) throw requestError(400,'Provide a course, positive credits and a valid attempt for each result.');
    const mark=result.mark!==undefined && result.mark!==null,grade=result.grade!==undefined;
    if (mark===grade || mark && (!Number.isInteger(result.mark) || result.mark<0 || result.mark>100) || grade && (typeof result.grade!=='string' || !result.grade.trim() || result.grade.length>20)) throw requestError(400,'Each result needs either a whole mark from 0 to 100 or a grade code.');
    const key=JSON.stringify([result.courseCode,result.attempt || 1]);
    if (attempts.has(key)) throw requestError(400,'A course attempt appears more than once in this example.');
    attempts.add(key);
  }
}

export function assertGpaSamples(samples) {
  if (!Array.isArray(samples) || samples.length>25) throw requestError(400,'Provide up to 25 worked examples.');
  for (const sample of samples) {
    if (!sample || typeof sample!=='object' || Array.isArray(sample) || Object.keys(sample).some(k=>!['name','results','expectedGpa','expectedClassification'].includes(k))
      || sample.name!==undefined && (typeof sample.name!=='string' || !sample.name.trim() || sample.name.length>200)
      || sample.expectedGpa!==null && (!Number.isFinite(sample.expectedGpa) || sample.expectedGpa<0)
      || sample.expectedClassification!==undefined && sample.expectedClassification!==null && (typeof sample.expectedClassification!=='string' || !sample.expectedClassification.trim() || sample.expectedClassification.length>200)) throw requestError(400,'Provide a bounded example name, expected GPA or null, and an optional expected classification.');
    assertGpaResults(sample.results);
    if (!sample.results.length) throw requestError(400,'Each worked example needs at least one result.');
  }
}

export function gradeForMark(scheme, mark) {
  const band = scheme.bands.find((item) => mark >= item.minMark && mark <= item.maxMark);
  if (!band) {
    throw requestError(400, `Mark ${mark} is outside 0-100.`);
  }
  return band;
}

export function roundGpa(value, { decimals, mode }) {
  const factor = 10 ** decimals;
  // The small epsilon keeps binary floating-point (e.g. 2.675) from rounding the wrong way.
  const scaled = value * factor + 1e-9;
  return (mode === "truncate" ? Math.floor(scaled) : Math.round(scaled)) / factor;
}

export function classify(scheme, gpa) {
  if (gpa === null) {
    return null;
  }
  const match = [...scheme.classifications].sort((a, b) => b.minGpa - a.minGpa).find((item) => gpa >= item.minGpa);
  return match ? match.label : null;
}

// results: [{ courseCode, credits, mark? , grade?, attempt? }]
export function calculateGpa(results, rules, scheme) {
  const excluded = [];
  const graded = [];
  for (const result of results) {
    if (result.grade && rules.excludeGrades.includes(result.grade)) {
      excluded.push({ courseCode: result.courseCode, attempt: result.attempt || 1, reason: `grade ${result.grade} is excluded` });
      continue;
    }
    let band;
    if (result.mark !== undefined && result.mark !== null) {
      band = gradeForMark(scheme, Number(result.mark));
    } else {
      band = scheme.bands.find((item) => item.grade === result.grade);
      if (!band) {
        throw requestError(400, `Grade ${result.grade} for ${result.courseCode} is not in the scheme or the exclusion list.`);
      }
    }
    graded.push({ ...result, attempt: result.attempt || 1, grade: band.grade, points: band.points, passing: band.passing });
  }

  let counted = graded;
  if (rules.retakePolicy !== "all") {
    const byCourse = new Map();
    for (const result of graded) {
      const current = byCourse.get(result.courseCode);
      const better = !current
        || (rules.retakePolicy === "latest" ? result.attempt > current.attempt : result.points > current.points);
      if (better) {
        if (current) {
          excluded.push({ courseCode: current.courseCode, attempt: current.attempt, reason: `superseded by ${rules.retakePolicy} attempt` });
        }
        byCourse.set(result.courseCode, result);
      } else {
        excluded.push({ courseCode: result.courseCode, attempt: result.attempt, reason: `superseded by ${rules.retakePolicy} attempt` });
      }
    }
    counted = [...byCourse.values()];
  }
  if (!rules.includeFailed) {
    for (const result of counted.filter((item) => !item.passing)) {
      excluded.push({ courseCode: result.courseCode, attempt: result.attempt, reason: "failed results are excluded" });
    }
    counted = counted.filter((item) => item.passing);
  }

  const credits = counted.reduce((sum, item) => sum + Number(item.credits), 0);
  let raw = null;
  if (counted.length > 0) {
    raw = rules.creditWeighted
      ? (credits > 0 ? counted.reduce((sum, item) => sum + item.points * Number(item.credits), 0) / credits : null)
      : counted.reduce((sum, item) => sum + item.points, 0) / counted.length;
  }
  const gpa = raw === null ? null : roundGpa(raw, rules.rounding);
  return {
    gpa,
    classification: classify(scheme, gpa),
    creditsCounted: credits,
    counted: counted.map(({ courseCode, attempt, grade, points, credits: courseCredits }) => ({ courseCode, attempt, grade, points, credits: courseCredits })),
    excluded
  };
}

export function runValidationSamples(samples, rules, scheme) {
  return samples.map((sample, index) => {
    try {
      const outcome = calculateGpa(sample.results, rules, scheme);
      const passed = outcome.gpa === sample.expectedGpa
        && (sample.expectedClassification === undefined || outcome.classification === sample.expectedClassification);
      return { sample: sample.name || `sample ${index + 1}`, passed, expectedGpa: sample.expectedGpa, actualGpa: outcome.gpa, expectedClassification: sample.expectedClassification, actualClassification: outcome.classification };
    } catch (error) {
      return { sample: sample.name || `sample ${index + 1}`, passed: false, error: error.message };
    }
  });
}

// ---------- persistence ----------

const schemeSelect = `select
  id, code, version, name, status, bands, classifications,
  to_char(effective_from, 'YYYY-MM-DD') as "effectiveFrom",
  to_char(effective_to, 'YYYY-MM-DD') as "effectiveTo",
  created_by as "createdBy", published_by as "publishedBy", published_at as "publishedAt"
from grading_schemes`;

const ruleSetSelect = `select
  id, code, version, name, status, rules, samples,
  grading_scheme_id as "gradingSchemeId",
  to_char(effective_from, 'YYYY-MM-DD') as "effectiveFrom",
  to_char(effective_to, 'YYYY-MM-DD') as "effectiveTo",
  created_by as "createdBy", published_by as "publishedBy", published_at as "publishedAt"
from gpa_rule_sets`;

export function createGradingModule(pool) {
  return {
    async listGradingSchemes() {
      return (await pool.query(`${schemeSelect} order by code, version desc`)).rows;
    },

    async createGradingScheme(input, actor) {
      requireFields(input, ["code", "name", "bands", "classifications"]);
      assertGradingScheme(input);
      return createVersioned(pool, actor, {
        table: "grading_schemes",
        select: schemeSelect,
        code: input.code,
        prefix: "gs",
        subjectType: "GradingScheme",
        columns: { name: input.name, bands: JSON.stringify(input.bands), classifications: JSON.stringify(input.classifications) },
        reason: input.reason
      });
    },

    async publishGradingScheme(schemeId, input, actor) {
      return publishVersioned(pool, actor, schemeId, input, { table: "grading_schemes", select: schemeSelect, subjectType: "GradingScheme" });
    },

    async retireGradingScheme(schemeId, input, actor) {
      return retireVersioned(pool, actor, schemeId, input, { table: "grading_schemes", select: schemeSelect, subjectType: "GradingScheme" });
    },

    async listGpaRuleSets() {
      return (await pool.query(`${ruleSetSelect} order by code, version desc`)).rows;
    },

    async createGpaRuleSet(input, actor) {
      requireFields(input, ["code", "name", "gradingSchemeId", "rules"]);
      assertGpaRules(input.rules);
      assertGpaSamples(input.samples === undefined ? [] : input.samples);
      const scheme = await findById(pool, schemeSelect, input.gradingSchemeId, "Grading scheme");
      if (scheme.status !== "published") {
        throw requestError(409, "GPA rule sets must reference a published grading scheme.");
      }
      return createVersioned(pool, actor, {
        table: "gpa_rule_sets",
        select: ruleSetSelect,
        code: input.code,
        prefix: "gpa",
        subjectType: "GpaRuleSet",
        columns: {
          name: input.name,
          grading_scheme_id: input.gradingSchemeId,
          rules: JSON.stringify(input.rules),
          samples: JSON.stringify(input.samples || [])
        },
        reason: input.reason
      });
    },

    async publishGpaRuleSet(ruleSetId, input, actor) {
      const ruleSet = await findById(pool, ruleSetSelect, ruleSetId, "GPA rule set");
      const scheme = await findById(pool, schemeSelect, ruleSet.gradingSchemeId, "Grading scheme");
      assertGpaSamples(ruleSet.samples);
      if (ruleSet.samples.length === 0) {
        throw requestError(409, "Add at least one worked example (samples) before publishing a GPA rule set.");
      }
      const outcomes = runValidationSamples(ruleSet.samples, ruleSet.rules, scheme);
      const failed = outcomes.filter((outcome) => !outcome.passed);
      if (failed.length > 0) {
        const error = requestError(409, `Worked examples failed: ${failed.map((item) => `${item.sample} expected ${item.expectedGpa}/${item.expectedClassification ?? "-"} got ${item.actualGpa ?? item.error}/${item.actualClassification ?? "-"}`).join("; ")}.`);
        throw error;
      }
      const published = await publishVersioned(pool, actor, ruleSetId, input, {
        table: "gpa_rule_sets",
        select: ruleSetSelect,
        subjectType: "GpaRuleSet",
        metadata: { validation: outcomes }
      });
      return { ...published, validation: outcomes };
    },

    async retireGpaRuleSet(ruleSetId, input, actor) {
      return retireVersioned(pool, actor, ruleSetId, input, { table: "gpa_rule_sets", select: ruleSetSelect, subjectType: "GpaRuleSet" });
    },

    async calculateGpaPreview(ruleSetId, input) {
      assertGpaResults(input.results);
      const ruleSet = await findById(pool, ruleSetSelect, ruleSetId, "GPA rule set");
      const scheme = await findById(pool, schemeSelect, ruleSet.gradingSchemeId, "Grading scheme");
      return {
        ruleSet: { id: ruleSet.id, code: ruleSet.code, version: ruleSet.version, status: ruleSet.status },
        gradingScheme: { id: scheme.id, code: scheme.code, version: scheme.version },
        ...calculateGpa(input.results, ruleSet.rules, scheme)
      };
    }
  };
}

async function findById(db, select, id, label, { forUpdate = false } = {}) {
  const result = await db.query(`${select} where id = $1 ${forUpdate ? "for update" : ""}`, [id]);
  if (result.rowCount === 0) {
    throw requestError(404, `${label} was not found.`);
  }
  return result.rows[0];
}

async function createVersioned(pool, actor, { table, select, code, prefix, subjectType, columns, reason }) {
  if (!/^[a-z0-9_]{3,40}$/.test(code)) {
    throw requestError(400, "code must be 3-40 lower-case letters, digits, or underscores.");
  }
  return withTransaction(pool, async (client) => {
    // Serialise version numbering per code.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`${table}:${code}`]);
    const next = await client.query(`select coalesce(max(version), 0) + 1 as version from ${table} where code = $1`, [code]);
    const version = next.rows[0].version;
    const id = `${prefix}_${code}_v${version}`;
    const names = Object.keys(columns);
    const values = Object.values(columns);
    await client.query(
      `insert into ${table} (id, code, version, status, created_by, ${names.join(", ")})
       values ($1, $2, $3, 'draft', $4, ${names.map((_, index) => `$${index + 5}`).join(", ")})`,
      [id, code, version, actor.accountId, ...values]
    );
    const created = await findById(client, select, id, subjectType);
    await insertAudit(client, {
      actorId: actor.accountId,
      action: `master_data.${table}.created`,
      subjectType,
      subjectId: id,
      reason: reason || `${subjectType} ${code} v${version} drafted`,
      metadata: { after: created }
    });
    return created;
  });
}

async function publishVersioned(pool, actor, id, input, { table, select, subjectType, metadata = {} }) {
  requireFields(input, ["reason", "effectiveFrom"]);
  const effectiveFrom = parseEffectiveDate(input.effectiveFrom);
  return withTransaction(pool, async (client) => {
    const before = await findById(client, select, id, subjectType, { forUpdate: true });
    if (before.status !== "draft") {
      throw requestError(409, `Only drafts can be published; this is ${before.status}.`);
    }
    assertSeparateApprover(before.createdBy, actor);
    const later = await client.query(
      `select version from ${table} where code = $1 and status = 'published' and effective_from >= $2::date`,
      [before.code, effectiveFrom]
    );
    if (later.rowCount > 0) {
      throw requestError(409, `Effective date must be after published version ${later.rows[0].version}.`);
    }
    const superseded = await client.query(
      `update ${table} set effective_to = $1::date - 1
       where code = $2 and status = 'published' and (effective_to is null or effective_to >= $1::date)
       returning id`,
      [effectiveFrom, before.code]
    );
    await client.query(
      `update ${table} set status = 'published', effective_from = $1, published_by = $2, published_at = now() where id = $3`,
      [effectiveFrom, actor.accountId, id]
    );
    const after = await findById(client, select, id, subjectType);
    await insertAudit(client, {
      actorId: actor.accountId,
      action: `master_data.${table}.published`,
      subjectType,
      subjectId: id,
      reason: input.reason,
      beforeRef: superseded.rows[0]?.id,
      afterRef: id,
      metadata: { ...metadata, supersededIds: superseded.rows.map((row) => row.id) }
    });
    return after;
  });
}

async function retireVersioned(pool, actor, id, input, { table, select, subjectType }) {
  requireFields(input, ["reason"]);
  const effectiveTo = parseEffectiveDate(input.effectiveTo);
  return withTransaction(pool, async (client) => {
    const before = await findById(client, select, id, subjectType, { forUpdate: true });
    if (before.status !== "published") {
      throw requestError(409, `Only published versions can be retired; this is ${before.status}.`);
    }
    if (table === "grading_schemes") {
      const dependants = await client.query(
        "select code, version from gpa_rule_sets where grading_scheme_id = $1 and status = 'published'",
        [id]
      );
      if (dependants.rowCount > 0) {
        throw requestError(409, `Published GPA rule sets still use this scheme: ${dependants.rows.map((row) => `${row.code} v${row.version}`).join(", ")}.`);
      }
    }
    await client.query(
      `update ${table} set status = 'retired', effective_to = least(coalesce(effective_to, $1::date), $1::date) where id = $2`,
      [effectiveTo, id]
    );
    const after = await findById(client, select, id, subjectType);
    await insertAudit(client, {
      actorId: actor.accountId,
      action: `master_data.${table}.retired`,
      subjectType,
      subjectId: id,
      reason: input.reason,
      metadata: { before, after }
    });
    return after;
  });
}
