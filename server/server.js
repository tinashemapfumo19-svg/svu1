import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { createLogger } from "./logger.js";
import { createRepository } from "./repository.js";
import { createRouter } from "./router.js";
import { createLocalStorage } from "./storage.js";
import { startReportScheduler } from './report-scheduler.js';
import { startEmailDeliveryWorker } from './email-delivery.js';
import { startAutomationScheduler } from './automation-scheduler.js';
import { startPushDispatcher } from './push-notifications.js';
import { startSmsDispatcher } from './sms.js';

const config = loadConfig();

const logger = createLogger(config);
const pool = createPool(config);
const repository = createRepository(pool, {
  devOutboxDir: config.devOutboxDir,
  dataEncryptionKey: config.dataEncryptionKey,
  mfaPolicy: config.mfaPolicy,
  schedulerEnabled: config.reportSchedulerEnabled,
  email: config.email,
  aiCheck: config.aiCheck,
  aiAssist: config.aiAssist,
  askSvuPersonal: config.askSvuPersonal,
  payments: config.payments,
  push: config.push,
  sms: config.sms,
  storage: config.devStorageDir ? createLocalStorage(config.devStorageDir) : null
});

const server = createServer(createRouter({
  rootDir: process.cwd(),
  config,
  repository,
  logger
}));

let reportScheduler,emailWorker,automations,pushDispatcher,smsDispatcher;
server.listen(config.port, config.host, () => {
  logger.info("server_started", {
    url: `http://${config.host}:${config.port}`,
    databaseUrl: maskDatabaseUrl(config.databaseUrl)
  });
  if(config.reportSchedulerEnabled)reportScheduler=startReportScheduler({repository,logger});
  if(config.email.provider!=='disabled')emailWorker=startEmailDeliveryWorker({repository,logger});
  if(config.automationsEnabled)automations=startAutomationScheduler({repository,logger});
  pushDispatcher=startPushDispatcher(pool,config.push,{logger});
  smsDispatcher=startSmsDispatcher(pool,config.sms,{logger});
});

let closing=false;
async function shutdown() {
  if(closing)return;closing=true;
  await reportScheduler?.stop();
  await emailWorker?.stop();
  await automations?.stop();
  pushDispatcher?.stop();
  smsDispatcher?.stop();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);

function maskDatabaseUrl(databaseUrl) {
  return databaseUrl.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}
