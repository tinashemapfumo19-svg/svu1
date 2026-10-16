import { randomBytes, randomUUID } from "node:crypto";
import { createTotpSecret, decryptSecret, digestToken, encryptSecret, matchTotp } from "../security.js";
import { insertAudit, requestError, requireFields, withTransaction } from "../support.js";

// TOTP multi-factor authentication. Seeds are encrypted at rest; codes cannot be replayed within their
// time step; recovery codes are single-use digests. Only an identity administrator can remove a factor.

const issuer = "South Valley University";
const recoveryCodeCount = 10;
const maxMfaFailuresPerSession = 5;

export function mfaRequirement({ policy, hasFactor, privileged }) {
  if (policy === "off") {
    return "none";
  }
  if (hasFactor) {
    return "verify";
  }
  return policy === "privileged" && privileged ? "enrol" : "none";
}

export function createRecoveryCode() {
  const hex = randomBytes(6).toString("hex");
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export function createIdentityMfaModule(pool, { dataEncryptionKey }) {
  return {
    async startTotpEnrolment(actor) {
      return withTransaction(pool, async (client) => {
        const active = await client.query(
          "select 1 from mfa_factors where account_id = $1 and factor_type = 'totp' and status = 'active'",
          [actor.accountId]
        );
        if (active.rowCount > 0) {
          throw requestError(409, "An authenticator is already enrolled. Ask an identity administrator to reset it.");
        }
        await client.query(
          "delete from mfa_factors where account_id = $1 and factor_type = 'totp' and status = 'pending'",
          [actor.accountId]
        );
        const secret = createTotpSecret();
        const factorId = `mfa_${randomUUID()}`;
        await client.query(
          `insert into mfa_factors (id, account_id, factor_type, secret_ciphertext, status)
           values ($1, $2, 'totp', $3, 'pending')`,
          [factorId, actor.accountId, encryptSecret(secret, dataEncryptionKey)]
        );
        const label = encodeURIComponent(`${issuer}:${actor.email}`);
        return {
          factorId,
          secret,
          otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
        };
      });
    },

    async confirmTotpEnrolment(actor, input) {
      requireFields(input, ["code"]);

      return withTransaction(pool, async (client) => {
        const pending = await client.query(
          `select id, secret_ciphertext from mfa_factors
           where account_id = $1 and factor_type = 'totp' and status = 'pending'
           order by created_at desc limit 1
           for update`,
          [actor.accountId]
        );
        if (pending.rowCount === 0) {
          throw requestError(409, "Start an enrolment before confirming it.");
        }
        const factor = pending.rows[0];
        const step = matchTotp(decryptSecret(factor.secret_ciphertext, dataEncryptionKey), input.code);
        if (step === null) {
          throw requestError(400, "That code does not match. Check the authenticator's clock and try again.");
        }

        await client.query(
          "update mfa_factors set status = 'active', activated_at = now(), last_used_step = $1 where id = $2",
          [step, factor.id]
        );
        await client.query("delete from mfa_recovery_codes where account_id = $1", [actor.accountId]);
        const recoveryCodes = Array.from({ length: recoveryCodeCount }, createRecoveryCode);
        for (const code of recoveryCodes) {
          await client.query(
            "insert into mfa_recovery_codes (id, account_id, code_digest) values ($1, $2, $3)",
            [`mrc_${randomUUID()}`, actor.accountId, digestToken(code)]
          );
        }
        await client.query("update accounts set mfa_required = true, updated_at = now() where id = $1", [actor.accountId]);
        // Enrolling proves the second factor, so this session is upgraded rather than ended.
        await client.query(
          `update sessions
           set status = 'active', assurance = 'mfa', mfa_verified_at = now(),
               expires_at = greatest(expires_at, now() + interval '8 hours')
           where id = $1`,
          [actor.sessionId]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "identity.mfa.enrolled",
          subjectType: "Account",
          subjectId: actor.accountId,
          reason: "Authenticator app enrolled",
          afterRef: factor.id
        });
        return { status: "enrolled", recoveryCodes, sessionStatus: "active" };
      });
    },

    async verifySessionMfa(actor, input) {
      if (!input.code && !input.recoveryCode) {
        throw requestError(400, "Provide code or recoveryCode.");
      }

      const factorResult = await pool.query(
        `select id, secret_ciphertext, last_used_step from mfa_factors
         where account_id = $1 and factor_type = 'totp' and status = 'active'`,
        [actor.accountId]
      );
      const factor = factorResult.rows[0];
      if (!factor) {
        throw requestError(409, "No authenticator is enrolled for this account.");
      }

      let method = null;
      let step = null;
      let recoveryCodeId = null;
      if (input.code) {
        step = matchTotp(decryptSecret(factor.secret_ciphertext, dataEncryptionKey), input.code);
        // A code may be used once: reject any step at or before the last accepted one.
        if (step !== null && (factor.last_used_step === null || step > Number(factor.last_used_step))) {
          method = "totp";
        }
      } else {
        const recovery = await pool.query(
          "select id from mfa_recovery_codes where account_id = $1 and code_digest = $2 and used_at is null",
          [actor.accountId, digestToken(String(input.recoveryCode).trim().toLowerCase())]
        );
        if (recovery.rowCount > 0) {
          method = "recovery_code";
          recoveryCodeId = recovery.rows[0].id;
        }
      }

      if (!method) {
        const failed = await pool.query(
          "update sessions set mfa_failed_attempts = mfa_failed_attempts + 1 where id = $1 returning mfa_failed_attempts",
          [actor.sessionId]
        );
        if (failed.rows[0].mfa_failed_attempts >= maxMfaFailuresPerSession) {
          await pool.query("update sessions set status = 'revoked', revoked_at = now() where id = $1", [actor.sessionId]);
          await insertAudit(pool, {
            actorId: actor.accountId,
            action: "identity.mfa.locked",
            subjectType: "Session",
            subjectId: actor.sessionId,
            reason: `${maxMfaFailuresPerSession} invalid second-factor codes; sign-in abandoned`
          });
          throw requestError(401, "Too many invalid codes. Sign in again.");
        }
        throw requestError(400, "That code is not valid.");
      }

      return withTransaction(pool, async (client) => {
        if (method === "totp") {
          const advanced = await client.query(
            "update mfa_factors set last_used_step = $1 where id = $2 and (last_used_step is null or last_used_step < $1)",
            [step, factor.id]
          );
          if (advanced.rowCount === 0) {
            throw requestError(400, "That code is not valid.");
          }
        } else {
          const used = await client.query(
            "update mfa_recovery_codes set used_at = now() where id = $1 and used_at is null",
            [recoveryCodeId]
          );
          if (used.rowCount === 0) {
            throw requestError(400, "That code is not valid.");
          }
        }
        await client.query(
          `update sessions
           set status = 'active', assurance = 'mfa', mfa_verified_at = now(), expires_at = now() + interval '8 hours'
           where id = $1 and status = 'mfa_pending'`,
          [actor.sessionId]
        );
        const remaining = await client.query(
          "select count(*)::int as remaining from mfa_recovery_codes where account_id = $1 and used_at is null",
          [actor.accountId]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "identity.mfa.verified",
          subjectType: "Session",
          subjectId: actor.sessionId,
          reason: method === "totp" ? "Authenticator code accepted" : "Recovery code used"
        });
        return { status: "active", method, recoveryCodesRemaining: remaining.rows[0].remaining };
      });
    },

    async resetMfa(accountId, input, actor) {
      requireFields(input, ["reason"]);

      return withTransaction(pool, async (client) => {
        const removed = await client.query("delete from mfa_factors where account_id = $1 returning id", [accountId]);
        if (removed.rowCount === 0) {
          throw requestError(404, "No authenticator is enrolled for this account.");
        }
        await client.query("delete from mfa_recovery_codes where account_id = $1", [accountId]);
        await client.query("update accounts set mfa_required = false, updated_at = now() where id = $1", [accountId]);
        const revoked = await client.query(
          "update sessions set status = 'revoked', revoked_at = now() where account_id = $1 and status <> 'revoked' and status <> 'expired' returning id",
          [accountId]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "identity.mfa.reset",
          subjectType: "Account",
          subjectId: accountId,
          reason: input.reason,
          metadata: { removedFactors: removed.rowCount, revokedSessions: revoked.rowCount }
        });
        return { status: "reset", revokedSessions: revoked.rowCount };
      });
    },

    async getMfaSummary(accountId) {
      const result = await pool.query(
        `select
          exists (select 1 from mfa_factors where account_id = $1 and status = 'active') as enrolled,
          (select count(*)::int from mfa_recovery_codes where account_id = $1 and used_at is null) as "recoveryCodesRemaining"`,
        [accountId]
      );
      return result.rows[0];
    }
  };
}
