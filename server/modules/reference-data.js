import {
  insertAudit,
  parseEffectiveDate,
  requestError,
  requireFields,
  withTransaction
} from "../support.js";

// Controlled reference lists (countries, levels, study modes, currency, restricted lists).
// Value codes are stored on records, so they are immutable; values are retired, never deleted.

const valueSelect = `select
  id,
  list_code as "listCode",
  value_code as "valueCode",
  label,
  status,
  sort_order as "sortOrder",
  metadata,
  to_char(effective_from, 'YYYY-MM-DD') as "effectiveFrom",
  to_char(effective_to, 'YYYY-MM-DD') as "effectiveTo"
from reference_values`;

export function assertReferenceValueIsValid(list, input) {
  const code = String(input.valueCode || "");
  if (!/^[A-Z0-9_]{1,40}$/.test(code)) {
    throw requestError(400, "Value code must be 1-40 upper-case letters, digits, or underscores.");
  }
  if (list.valuePattern && !new RegExp(list.valuePattern).test(code)) {
    throw requestError(400, `Value code ${code} does not match the ${list.code} format ${list.valuePattern}.`);
  }
  if (list.code === "currency") {
    const minorUnits = input.metadata?.minorUnits;
    if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 4) {
      throw requestError(400, "Currencies require metadata.minorUnits between 0 and 4.");
    }
  }
}

export function isValueActiveOn(value, date) {
  return value.status === "active"
    && (!value.effectiveFrom || value.effectiveFrom <= date)
    && (!value.effectiveTo || value.effectiveTo >= date);
}

export function createReferenceDataModule(pool) {
  return {
    async listReferenceLists() {
      const result = await pool.query(
        `select
          l.code,
          l.name,
          l.owner,
          l.sensitivity,
          l.lawful_purpose as "lawfulPurpose",
          l.status,
          count(v.id) filter (where v.status = 'active')::int as "activeValues"
        from reference_lists l
        left join reference_values v on v.list_code = l.code
        group by l.code
        order by l.code`
      );
      return result.rows;
    },

    async getReferenceList(listCode, options = {}) {
      const list = await findList(pool, listCode);
      const asOf = parseEffectiveDate(options.asOf);
      const result = await pool.query(`${valueSelect} where list_code = $1 order by sort_order, label`, [listCode]);
      const values = options.includeRetired ? result.rows : result.rows.filter((value) => isValueActiveOn(value, asOf));
      return { ...list, asOf, values };
    },

    async createReferenceValue(listCode, input, actor) {
      requireFields(input, ["valueCode", "label"]);

      return withTransaction(pool, async (client) => {
        const list = await findList(client, listCode);
        if (list.status !== "active") {
          throw requestError(409, `The ${list.code} list is ${list.status}; values cannot be added until it is approved.`);
        }
        assertReferenceValueIsValid(list, input);
        const duplicate = await client.query(
          "select 1 from reference_values where list_code = $1 and value_code = $2",
          [listCode, input.valueCode]
        );
        if (duplicate.rowCount > 0) {
          throw requestError(409, `${input.valueCode} already exists in ${listCode}; restore it instead of re-creating it.`);
        }
        const id = `ref_${listCode}_${input.valueCode.toLowerCase()}`;
        await client.query(
          `insert into reference_values (id, list_code, value_code, label, status, sort_order, metadata, effective_from)
           values ($1, $2, $3, $4, 'active', $5, $6, $7)`,
          [id, listCode, input.valueCode, input.label, input.sortOrder ?? 1000, input.metadata || {}, parseEffectiveDate(input.effectiveFrom)]
        );
        const value = await findValue(client, id);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.reference_value.created",
          subjectType: "ReferenceValue",
          subjectId: id,
          reason: input.reason || `Added ${input.valueCode} to ${listCode}`,
          metadata: { after: value }
        });
        return value;
      });
    },

    async updateReferenceValue(valueId, input, actor) {
      requireFields(input, ["reason"]);
      if (input.valueCode !== undefined) {
        throw requestError(400, "Value codes are immutable; retire this value and add a new one.");
      }
      if (input.label === undefined && input.sortOrder === undefined && input.metadata === undefined) {
        throw requestError(400, "Provide label, sortOrder, or metadata to change.");
      }

      return withTransaction(pool, async (client) => {
        const before = await findValue(client, valueId, { forUpdate: true });
        const list = await findList(client, before.listCode);
        const metadata = input.metadata === undefined ? before.metadata : input.metadata;
        assertReferenceValueIsValid(list, { valueCode: before.valueCode, metadata });
        await client.query(
          "update reference_values set label = $1, sort_order = $2, metadata = $3 where id = $4",
          [input.label ?? before.label, input.sortOrder ?? before.sortOrder, metadata, valueId]
        );
        const after = await findValue(client, valueId);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.reference_value.updated",
          subjectType: "ReferenceValue",
          subjectId: valueId,
          reason: input.reason,
          metadata: { before, after }
        });
        return after;
      });
    },

    async setReferenceValueStatus(valueId, status, input, actor) {
      requireFields(input, ["reason"]);

      return withTransaction(pool, async (client) => {
        const before = await findValue(client, valueId, { forUpdate: true });
        if (before.status === status) {
          throw requestError(409, `Value is already ${status}.`);
        }
        if (status === "active") {
          const list = await findList(client, before.listCode);
          if (list.status !== "active") {
            throw requestError(409, `The ${list.code} list is ${list.status}.`);
          }
        }
        const effectiveTo = status === "retired" ? parseEffectiveDate(input.effectiveTo) : null;
        if (effectiveTo && before.effectiveFrom && effectiveTo < before.effectiveFrom) {
          throw requestError(400, "Retirement date cannot be before the value's effective start date.");
        }
        await client.query(
          "update reference_values set status = $1, effective_to = $2 where id = $3",
          [status, effectiveTo, valueId]
        );
        const after = await findValue(client, valueId);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: status === "retired" ? "master_data.reference_value.retired" : "master_data.reference_value.restored",
          subjectType: "ReferenceValue",
          subjectId: valueId,
          reason: input.reason,
          beforeRef: before.status,
          afterRef: after.status,
          metadata: { before, after }
        });
        return after;
      });
    }
  };
}

async function findList(db, listCode) {
  const result = await db.query(
    `select code, name, owner, sensitivity, lawful_purpose as "lawfulPurpose", status, value_pattern as "valuePattern"
     from reference_lists where code = $1`,
    [listCode]
  );
  if (result.rowCount === 0) {
    throw requestError(404, `Reference list ${listCode} was not found.`);
  }
  return result.rows[0];
}

async function findValue(db, valueId, { forUpdate = false } = {}) {
  const result = await db.query(`${valueSelect} where id = $1 ${forUpdate ? "for update" : ""}`, [valueId]);
  if (result.rowCount === 0) {
    throw requestError(404, "Reference value was not found.");
  }
  return result.rows[0];
}
