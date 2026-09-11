/** 投递任务的队列种类；投递 worker 按它认领。 */
export const DELIVER_JOB_KIND = 'events.deliver';

export interface DeliverJobPayload {
  readonly deliveryId: string;
}

/** 把一次投递排入队列，与投递记录同一事务；同一 deliveryId 处于待执行状态时不重复入队。 */
export interface DeliveryScheduler {
  schedule(deliveryId: string): Promise<void>;
}
