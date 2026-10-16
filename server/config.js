import { createHash } from "node:crypto";
import { loadEmailConfig } from './email-provider.js';
import { loadAiCheckConfig } from './ai-checker.js';
import { resolveAutomations } from './automation-scheduler.js';
import { loadAiAssistConfig } from './ai-assist.js';
import { loadPaymentsConfig } from './payment-gateway.js';
import { loadPushConfig } from './push-notifications.js';
import { loadSmsConfig } from './sms.js';

export function loadConfig(env = process.env) {
  const runtimeEnv = env.SVU_ENV || env.NODE_ENV || "development";
  const email=loadEmailConfig(env);
  if(email.provider!=='disabled' && !env.SVU_DATA_KEY)throw new Error('Configured email delivery requires an explicit secure SVU_DATA_KEY, including in development.');
  return {
    appName: env.SVU_APP_NAME || "South Valley University",
    env: runtimeEnv,
    host: env.SVU_HOST || "127.0.0.1",
    port: Number.parseInt(env.SVU_PORT || "4173", 10),
    dataFile: env.SVU_DATA_FILE || "data/dev-store.json",
    databaseUrl: env.DATABASE_URL || env.SVU_DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/svu_rebuild",
    logLevel: env.SVU_LOG_LEVEL || "info",
    email,
    // Assignment AI-similarity checking: disabled unless a provider is configured.
    aiCheck: loadAiCheckConfig(env),
    // Scheduled reminders and digests; off unless explicitly enabled.
    automationsEnabled: resolveAutomations(env.SVU_AUTOMATIONS),
    // Claude-backed assistance (feedback drafts, triage, Q&A, document check, explanations); off by default.
    aiAssist: loadAiAssistConfig(env),
    // Ask SVU may read the person's own upcoming dates, fees and work counts to answer about them (D-41); off by default.
    askSvuPersonal: resolveAskSvuPersonal(env.SVU_ASK_SVU_PERSONAL),
    // Online fee payments through a provider (Paynow) or a development-only simulation; off by default.
    payments: loadPaymentsConfig(env),
    // Push notifications to installed apps and browsers; off unless SVU_PUSH=enabled with VAPID keys.
    push: loadPushConfig(env),
    // Text messages for urgent notices (opt-in, verified numbers); off unless SVU_SMS is set.
    sms: loadSmsConfig(env),
    // Development-only mail catcher for sensitive messages; never enabled outside development.
    devOutboxDir: runtimeEnv === "development" ? env.SVU_DEV_OUTBOX || "data/dev-outbox" : null,
    // Local document storage for development only; other environments wait for ADR-004 object storage.
    devStorageDir: runtimeEnv === "development" ? env.SVU_DEV_STORAGE || "data/dev-storage" : null,
    dataEncryptionKey: resolveDataEncryptionKey(env, runtimeEnv),
    reportSchedulerEnabled: resolveReportScheduler(env.SVU_REPORT_SCHEDULER, runtimeEnv),
    // off: never ask; enrolled: ask accounts that enrolled; privileged: also force high-risk roles to enrol.
    mfaPolicy: resolveMfaPolicy(env.SVU_MFA_POLICY || (runtimeEnv === "development" ? "enrolled" : "privileged"))
  };
}

function resolveReportScheduler(value,runtimeEnv) {
  if(value === undefined)return runtimeEnv === 'development';
  if(!['enabled','disabled'].includes(value))throw new Error('SVU_REPORT_SCHEDULER must be enabled or disabled.');
  return value === 'enabled';
}

// SVU_DATA_KEY is a base64-encoded 32-byte key used to encrypt secrets at rest. Development falls
// back to a fixed, publicly known key; every other environment must provide one.
export function resolveAskSvuPersonal(value = 'disabled') {
  if (!['disabled', 'enabled'].includes(value)) throw new Error('SVU_ASK_SVU_PERSONAL must be disabled or enabled.');
  return value === 'enabled';
}

function resolveDataEncryptionKey(env, runtimeEnv) {
  if (env.SVU_DATA_KEY) {
    const key = Buffer.from(env.SVU_DATA_KEY, "base64");
    if (key.length !== 32) {
      throw new Error("SVU_DATA_KEY must be a base64-encoded 32-byte key.");
    }
    return key;
  }
  if (runtimeEnv !== "development") {
    throw new Error(`SVU_DATA_KEY is required when SVU_ENV is ${runtimeEnv}.`);
  }
  return createHash("sha256").update("svu-development-only-data-key").digest();
}

function resolveMfaPolicy(policy) {
  if (!["off", "enrolled", "privileged"].includes(policy)) {
    throw new Error(`SVU_MFA_POLICY must be off, enrolled, or privileged (got ${policy}).`);
  }
  return policy;
}
