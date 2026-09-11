import type { Logger } from '@crewstation/kernel';
import type { Worker, WorkerOptions } from '@crewstation/queue';
import { createWorker } from '@crewstation/queue';
import { z } from 'zod';
import type { DeliverOutcome } from '../api/moduleApi';
import { DELIVER_JOB_KIND } from '../ports/deliveryScheduler';

const PayloadSchema = z.object({ deliveryId: z.string().min(1) });

export interface DeliveryWorkerOptions {
  db: WorkerOptions['db'];
  deliver(deliveryId: string): Promise<DeliverOutcome>;
  /** 队列租约持有者名，日志与排障用。 */
  owner: string;
  concurrency: number;
  logger?: Logger;
}

/** 投递 worker：一个任务一次尝试。结果为 retrying 时抛错，让队列按退避重排；delivered／dead 或已是终态则完成任务。 */
export function createDeliveryWorker(options: DeliveryWorkerOptions): Worker {
  return createWorker({
    db: options.db,
    kinds: [DELIVER_JOB_KIND],
    owner: options.owner,
    concurrency: options.concurrency,
    ...(options.logger ? { logger: options.logger } : {}),
    handler: async (job) => {
      const { deliveryId } = PayloadSchema.parse(job.payload);
      const outcome = await options.deliver(deliveryId);
      if (outcome.state === 'retrying') throw new Error(outcome.error ?? `投递 ${deliveryId} 失败，等待重试`);
    },
  });
}
