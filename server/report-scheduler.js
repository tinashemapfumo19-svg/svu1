export function startReportScheduler({repository,logger,intervalMs=30000}) {
  if(!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 300000)throw new Error('Invalid report scheduler interval.');
  let stopped=false,inFlight=null;
  const tick=() => {
    if(stopped || inFlight)return;
    inFlight=repository.runDueReportSchedules({limit:5}).then(({runs}) => {if(runs.length)logger.info('report_schedule_batch',{processed:runs.length});})
      .catch(() => logger.error('report_schedule_batch_failed',{code:'SCHEDULER_UNAVAILABLE'})).finally(() => {inFlight=null;});
  };
  const timer=setInterval(tick,intervalMs);timer.unref?.();tick();
  return {async stop(){stopped=true;clearInterval(timer);await inFlight;}};
}
