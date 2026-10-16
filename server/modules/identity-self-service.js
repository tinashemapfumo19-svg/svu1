import { randomUUID } from "node:crypto";
import { createSecret, digestToken, hashSecret, normalizeEmail, passwordProblems, verifySecret } from "../security.js";
import { queueNotification } from "../notification-queue.js";
import { insertAudit, requestError, requireFields, withTransaction } from "../support.js";

// Self-service identity: who am I, and password recovery. Recovery responses never reveal whether
// an email belongs to an account; the code is delivered only through the notification queue.

const recoveryTtlMinutes = 30;
const maxRecoveryRequestsPerHour = 3;
// Wrong current passwords share the sign-in failure budget, so a stolen session cannot guess the password freely.
const maxPasswordFailures = 5;
const passwordFailureWindowMinutes = 15;

export function createIdentitySelfServiceModule(pool, { devOutboxDir = null, dataEncryptionKey } = {}) {
  return {
    async getMe(actor) {
      const result = await pool.query(
        `select
          a.id,
          a.email,
          a.status,
          a.mfa_required as "mfaRequired",
          a.last_login_at as "lastLoginAt",
          p.id as "personId",
          p.preferred_name as "preferredName",
          p.legal_name as "legalName",
          p.personas
        from accounts a
        join people p on p.id = a.person_id
        where a.id = $1`,
        [actor.accountId]
      );
      const row = result.rows[0];
      return {
        account: { id: row.id, email: row.email, status: row.status, mfaRequired: row.mfaRequired, lastLoginAt: row.lastLoginAt },
        person: { id: row.personId, preferredName: row.preferredName, legalName: row.legalName, personas: row.personas },
        roles: actor.roles,
        permissions: [...actor.permissions].sort(),
        sessionId: actor.sessionId
      };
    },

    async changeOwnPassword(actor, input) {
      requireFields(input, ["currentPassword", "newPassword"]);
      const account = (await pool.query("select id, email, password_hash, password_salt from accounts where id = $1 and status = 'active'", [actor.accountId])).rows[0];
      if (!account?.password_hash) throw requestError(400, "This account has no password to change.");
      const email = normalizeEmail(account.email);
      const recent = await pool.query(
        "select count(*)::int as failures from login_failures where email_normalized = $1 and occurred_at > now() - make_interval(mins => $2)",
        [email, passwordFailureWindowMinutes]
      );
      if (recent.rows[0].failures >= maxPasswordFailures) throw requestError(429, `Too many failed attempts. Try again in ${passwordFailureWindowMinutes} minutes.`);
      if (!await verifySecret(String(input.currentPassword), account.password_hash, account.password_salt)) {
        await pool.query("insert into login_failures (id, email_normalized) values ($1, $2)", [`lf_${randomUUID()}`, email]);
        await insertAudit(pool, { actorId: actor.accountId, action: "identity.password.change_failed", subjectType: "Account", subjectId: actor.accountId, reason: "Current password did not match" });
        throw requestError(400, "Current password is incorrect.");
      }
      if (input.currentPassword === input.newPassword) throw requestError(400, "Choose a password you have not just used.");
      const problems = passwordProblems(String(input.newPassword), email);
      if (problems.length > 0) throw requestError(400, `Password rejected: ${problems.join("; ")}.`);
      const password = await hashSecret(String(input.newPassword));
      return withTransaction(pool, async (client) => {
        await client.query("update accounts set password_hash = $1, password_salt = $2, password_set_at = now(), updated_at = now() where id = $3", [password.hash, password.salt, actor.accountId]);
        // Every other device must sign in again with the new password; this session stays signed in.
        const revoked = await client.query(
          "update sessions set status = 'revoked', revoked_at = now() where account_id = $1 and id <> $2 and status <> 'revoked' returning id",
          [actor.accountId, actor.sessionId]
        );
        await client.query("delete from login_failures where email_normalized = $1", [email]);
        await queueNotification(client, actor.accountId, "identity.password_changed", {},{link:'#settings'});
        await insertAudit(client, { actorId: actor.accountId, action: "identity.password.changed", subjectType: "Account", subjectId: actor.accountId, reason: "Password changed by account holder", metadata: { revokedSessions: revoked.rowCount } });
        return { status: "password_changed", revokedSessions: revoked.rowCount };
      });
    },

    async listOwnSessions(actor) {
      const rows = (await pool.query(
        `select id, status, user_agent as "userAgent", created_at as "createdAt", expires_at as "expiresAt"
         from sessions where account_id = $1 and status <> 'revoked' and revoked_at is null and expires_at > now()
         order by created_at desc limit 50`,
        [actor.accountId]
      )).rows;
      return rows.map((row) => ({ ...row, current: row.id === actor.sessionId }));
    },

    async revokeOtherSessions(actor) {
      return withTransaction(pool, async (client) => {
        const revoked = await client.query(
          "update sessions set status = 'revoked', revoked_at = now() where account_id = $1 and id <> $2 and status <> 'revoked' returning id",
          [actor.accountId, actor.sessionId]
        );
        await insertAudit(client, { actorId: actor.accountId, action: "identity.sessions.revoked_others", subjectType: "Account", subjectId: actor.accountId, reason: "Signed out of other devices", metadata: { revokedSessions: revoked.rowCount } });
        return { revokedSessions: revoked.rowCount };
      });
    },

    async requestPasswordRecovery(input) {
      requireFields(input, ["email"]);
      const email = normalizeEmail(input.email);
      const accepted = {
        status: "accepted",
        message: "If an active account uses this email, a reset code has been sent to it."
      };

      // Inactive duplicates are still ambiguous identities, not a reason to select the active one.
      const account = await pool.query("select id, status from accounts where lower(btrim(email)) = $1 limit 2", [email]);
      if (account.rows.length !== 1 || account.rows[0].status !== 'active') {
        return accepted;
      }
      const accountId = account.rows[0].id;
      const recent = await pool.query(
        "select count(*)::int as requests from password_recovery_tokens where account_id = $1 and created_at > now() - interval '1 hour'",
        [accountId]
      );
      if (recent.rows[0].requests >= maxRecoveryRequestsPerHour) {
        return accepted;
      }

      const token = createSecret();
      await withTransaction(pool, async (client) => {
        await client.query(
          "update password_recovery_tokens set status = 'superseded' where account_id = $1 and status = 'active'",
          [accountId]
        );
        const tokenId = `prt_${randomUUID()}`;
        await client.query(
          `insert into password_recovery_tokens (id, account_id, token_digest, status, expires_at)
           values ($1, $2, $3, 'active', now() + make_interval(mins => $4))`,
          [tokenId, accountId, digestToken(token), recoveryTtlMinutes]
        );
        await queueNotification(client, accountId, "identity.password_recovery", {
          recoveryToken: token,
          expiresInMinutes: recoveryTtlMinutes
        }, { sensitive: true, devOutboxDir, dataEncryptionKey, recipientEmail: email });
        await insertAudit(client, {
          actorId: "anonymous",
          action: "identity.password_recovery.requested",
          subjectType: "Account",
          subjectId: accountId,
          reason: "Password recovery requested",
          afterRef: tokenId
        });
      });
      return accepted;
    },

    async confirmPasswordRecovery(input) {
      requireFields(input, ["token", "password"]);
      const digest = digestToken(input.token);
      const pending = await pool.query(
        `select t.id, t.account_id, a.email
         from password_recovery_tokens t
         join accounts a on a.id = t.account_id
         where t.token_digest = $1 and t.status = 'active' and t.expires_at > now() and a.status = 'active'`,
        [digest]
      );
      if (pending.rowCount === 0) {
        throw requestError(400, "Reset code is invalid or expired.");
      }
      const { id: tokenId, account_id: accountId, email } = pending.rows[0];
      const problems = passwordProblems(input.password, email);
      if (problems.length > 0) {
        throw requestError(400, `Password rejected: ${problems.join("; ")}.`);
      }
      const password = await hashSecret(input.password);

      return withTransaction(pool, async (client) => {
        const claimed = await client.query(
          "update password_recovery_tokens set status = 'used', used_at = now() where id = $1 and status = 'active'",
          [tokenId]
        );
        if (claimed.rowCount === 0) {
          throw requestError(400, "Reset code is invalid or expired.");
        }
        await client.query(
          `update accounts
           set password_hash = $1, password_salt = $2, password_set_at = now(), updated_at = now()
           where id = $3`,
          [password.hash, password.salt, accountId]
        );
        const revoked = await client.query(
          "update sessions set status = 'revoked', revoked_at = now() where account_id = $1 and status = 'active' returning id",
          [accountId]
        );
        await client.query("delete from login_failures where email_normalized = $1", [normalizeEmail(email)]);
        await queueNotification(client, accountId, "identity.password_changed", {},{link:'#settings'});
        await insertAudit(client, {
          actorId: accountId,
          action: "identity.password.reset",
          subjectType: "Account",
          subjectId: accountId,
          reason: "Password reset with recovery code",
          beforeRef: tokenId,
          metadata: { revokedSessions: revoked.rowCount }
        });
        return { status: "password_changed", revokedSessions: revoked.rowCount };
      });
    }
  };
}
