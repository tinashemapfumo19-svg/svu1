import { loadConfig } from "../server/config.js";
import { createPool } from "../server/db.js";
import { loadReferenceData } from "./reference-data.js";
import { loadWorkflowDefinitions } from "./workflow-definitions.js";
import { loadNotificationTemplates } from "./notification-templates.js";
import { loadIntegrationCatalogue } from "./integration-catalogue.js";

const pool = createPool(loadConfig());

try {
  const inserted = await loadReferenceData(pool);
  const definitions = await loadWorkflowDefinitions(pool);
  const templates = await loadNotificationTemplates(pool);
  const connections = await loadIntegrationCatalogue(pool);
  console.log(`Baseline loaded: ${inserted} reference value(s), ${definitions} workflow definition(s), ${templates} notification template(s), ${connections} integration connection(s) inserted.`);
} finally {
  await pool.end();
}
