import {loadConfig} from '../server/config.js';
import {createPool} from '../server/db.js';
import {createReportSchedulesModule} from '../server/modules/report-schedules.js';

const config=loadConfig();
if(!config.reportSchedulerEnabled)throw new Error('Report scheduling is disabled; enable the governed worker explicitly.');
const pool=createPool(config);
try {const result=await createReportSchedulesModule(pool,{dataEncryptionKey:config.dataEncryptionKey,schedulerEnabled:true}).runDueReportSchedules({limit:5});console.log(JSON.stringify(result));}
finally {await pool.end();}
