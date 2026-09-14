import type { Executor } from '@crewstation/persistence';
import { precondition } from '@crewstation/kernel';
import { enqueueJob } from '@crewstation/queue';
import type { DeliverJobPayload, DeliveryScheduler } from '../../ports/deliveryScheduler';
import { DELIVER_JOB_KIND } from '../../ports/deliveryScheduler';

/**
 * 一条投递一个队列任务（dedupKey = deliveryId）。失败重试由队列按与投递状态机相同的退避公式重排；
 * 任务的尝试上限比投递上限多留余量，保证 dead 总是先由投递状态机判定、再由 worker 正常完成任务。
 */
export function queueDeliveryScheduler(executor: Executor, jobMaxAttempts: number): DeliveryScheduler {
  return {
    schedule: async (deliveryId) => {
      const payload: DeliverJobPayload = { deliveryId };
      const queued = await enqueueJob(executor, DELIVER_JOB_KIND, payload, { dedupKey: deliveryId, maxAttempts: jobMaxAttempts });
      // 死信可能已落库但旧 worker 尚未完成队列任务；去重不是新一轮重放已受理。
      if (queued.deduplicated) throw precondition('投递的上一项队列任务尚未结束，请稍后重试', { deliveryId });
    },
  };
}
