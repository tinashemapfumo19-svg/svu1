import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createSeedData } from "../scripts/seed-data.js";

export async function loadStore(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    const seed = createSeedData();
    await saveStore(filePath, seed);
    return seed;
  }
}

export async function saveStore(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function appendAudit(store, event) {
  const auditEvent = {
    id: `audit_${randomUUID()}`,
    occurredAt: new Date().toISOString(),
    source: "svu-foundation",
    ...event
  };
  store.auditEvents.unshift(auditEvent);
  return auditEvent;
}
