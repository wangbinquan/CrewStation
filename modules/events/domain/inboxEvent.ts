import type { EventId, TraceId } from '@crewstation/contracts';

/** 收件箱中的一条事件：(producer, dedupKey) 唯一；traceId 延续生产方给出的或在此生成，之后的每次投递与业务任务都继承它。 */
export interface InboxEvent {
  readonly id: EventId;
  readonly producerId: string;
  readonly producer: string;
  readonly producerProject: string;
  readonly eventTypeId: string;
  readonly eventType: string;
  readonly dedupKey: string;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
  readonly traceId: TraceId;
  readonly payload: unknown;
}
