/** 投递任务的队列种类；投递 worker 按它认领。 */
export const DELIVER_JOB_KIND = 'events.deliver';

export interface DeliverJobPayload {
  readonly deliveryId: string;
}

/** 与投递记录同一事务入队；已有活动任务时抛冲突，调用方回滚，不能把去重当作重放成功。 */
export interface DeliveryScheduler {
  /** `runAt` 缺省为立即；补发暂存投递时按接收顺序依次递增（RFC-021）。 */
  schedule(deliveryId: string, runAt?: Date): Promise<void>;
}
