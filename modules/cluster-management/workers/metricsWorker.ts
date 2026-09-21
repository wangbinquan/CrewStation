import type { Logger } from '@crewstation/kernel';
import { createWorker } from '@crewstation/queue';
import type { CollectorKind } from '../ports/metrics';
import type { MetricsDeps } from '../application/observeMetrics';
import { observeMetrics } from '../application/observeMetrics';
import { observeStorage } from '../application/observeStorage';
import { METRICS_JOB, STORAGE_JOB } from '../ports/metrics';

export function metricsWorkers(deps: MetricsDeps, db: Parameters<typeof createWorker>[0]['db'], instance: string, logger: Logger, measure: Parameters<typeof observeStorage>[3]) {
  let abort = new AbortController(), timer: ReturnType<typeof setInterval> | undefined;
  const worker = (kind: CollectorKind) => createWorker({ db, owner: `${instance}.cluster.${kind}`, kinds: [kind === 'metrics' ? METRICS_JOB : STORAGE_JOB], concurrency: 1, leaseSeconds: 60, logger, handler: async (job, ctx) => {
    const ticket = { requestId: (job.payload as { requestId: string }).requestId, fence: job.fencingToken };
    if (!await deps.repository.claim(kind, ticket)) return;
    const lease = new AbortController(), signal = AbortSignal.any([abort.signal, lease.signal, AbortSignal.timeout(110_000)]);
    const heartbeat = setInterval(() => { void ctx.heartbeat().then((ok) => { if (!ok) lease.abort(); }).catch(() => lease.abort()); }, 15_000);
    try {
      if (kind === 'metrics') await observeMetrics(deps, ticket, signal); else await observeStorage(deps, ticket, signal, measure);
      signal.throwIfAborted(); await deps.repository.finish(kind, ticket);
    } finally { clearInterval(heartbeat); }
  } });
  const metrics = worker('metrics'), storage = worker('storage');
  const schedule = () => { void Promise.all([deps.repository.schedule('metrics'), deps.repository.schedule('storage')]).catch((error: unknown) => logger.warn('cluster metrics scheduling failed', { error: String(error) })); };
  return { start: () => { if (!deps.options.enabled) return; abort = new AbortController(); metrics.start(); storage.start(); schedule(); timer ??= setInterval(schedule, 5000); }, stop: async () => { if (timer) clearInterval(timer); timer = undefined; abort.abort(); await Promise.all([metrics.stop(), storage.stop()]); }, runOnce: async () => (await metrics.runOnce()) + (await storage.runOnce()) };
}
