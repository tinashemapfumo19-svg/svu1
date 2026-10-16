// Runs the reminder and digest sweep on an interval when SVU_AUTOMATIONS=enabled (docs/AUTOMATIONS.md).
export function resolveAutomations(value) {
  if (value === undefined) return false;
  if (!['enabled', 'disabled'].includes(value)) throw new Error('SVU_AUTOMATIONS must be enabled or disabled.');
  return value === 'enabled';
}

export function startAutomationScheduler({ repository, logger, intervalMs = 15 * 60 * 1000 }) {
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 24 * 60 * 60 * 1000) throw new Error('Invalid automation interval.');
  let stopped = false, inFlight = null;
  const tick = () => {
    if (stopped || inFlight) return;
    inFlight = repository.runAutomationSweep().then(({ results, failed }) => {
      const sent = Object.values(results).reduce((sum, row) => sum + (row.sent || 0), 0);
      if (sent || failed) logger[failed ? 'error' : 'info']('automation_sweep', { sent, failed });
    }).catch(() => logger.error('automation_sweep_failed', { code: 'AUTOMATIONS_UNAVAILABLE' })).finally(() => { inFlight = null; });
  };
  const timer = setInterval(tick, intervalMs); timer.unref?.(); tick();
  return { async stop() { stopped = true; clearInterval(timer); await inFlight; } };
}
