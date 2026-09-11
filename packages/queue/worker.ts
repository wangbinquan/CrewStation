import type { Logger } from '@crewstation/kernel';
import { noopLogger } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { ClaimedJob } from './jobs';
import { claimJobs, completeJob, failJob, heartbeatJob } from './jobs';

export interface JobContext {
  /** 长任务定期续租；返回 false 说明租约已被他人接管，应立即停止副作用。 */
  heartbeat(): Promise<boolean>;
}

export type JobHandler = (job: ClaimedJob, ctx: JobContext) => Promise<void>;

export interface WorkerOptions {
  db: Database;
  kinds: string[];
  owner: string;
  handler: JobHandler;
  concurrency?: number;
  pollMs?: number;
  leaseSeconds?: number;
  logger?: Logger;
}

export interface Worker {
  start(): void;
  stop(): Promise<void>;
  /** 立即执行一轮认领；测试与关机排空用。 */
  runOnce(): Promise<number>;
}

export function createWorker(options: WorkerOptions): Worker {
  const { db, kinds, owner, handler } = options;
  const concurrency = options.concurrency ?? 1;
  const pollMs = options.pollMs ?? 1000;
  const leaseSeconds = options.leaseSeconds ?? 60;
  const logger = (options.logger ?? noopLogger).child({ queueOwner: owner });
  let running = false;
  let inFlight = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const runJob = async (job: ClaimedJob): Promise<void> => {
    inFlight += 1;
    const ctx: JobContext = { heartbeat: () => heartbeatJob(db, job.id, job.fencingToken, leaseSeconds) };
    try {
      await handler(job, ctx);
      if (!(await completeJob(db, job.id, job.fencingToken))) logger.warn('job completion rejected: stale lease', { jobId: job.id });
    } catch (error) {
      const outcome = await failJob(db, job, error instanceof Error ? error.stack ?? error.message : String(error));
      logger.error('job failed', { jobId: job.id, kind: job.kind, attempts: job.attempts, outcome });
    } finally {
      inFlight -= 1;
    }
  };

  const runOnce = async (): Promise<number> => {
    const room = concurrency - inFlight;
    if (room <= 0) return 0;
    const jobs = await claimJobs(db, kinds, owner, leaseSeconds, room);
    await Promise.all(jobs.map(runJob));
    return jobs.length;
  };

  const loop = async (): Promise<void> => {
    if (!running) return;
    try {
      const n = await runOnce();
      timer = setTimeout(loop, n > 0 ? 0 : pollMs);
    } catch (error) {
      logger.error('worker loop error', { error: String(error) });
      timer = setTimeout(loop, pollMs);
    }
  };

  return {
    start: () => { if (!running) { running = true; void loop(); } },
    stop: async () => {
      running = false;
      if (timer) clearTimeout(timer);
      while (inFlight > 0) await Bun.sleep(20);
    },
    runOnce,
  };
}
