import type { DeliveryState, EventId, ProjectId, ServiceId, TraceId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import { backoffSeconds } from './backoff';

/**
 * 一条事件对一个订阅的投递：pending → delivering → delivered；失败 → retrying（按退避重试）→ 超过上限 dead；
 * dead 可由负责人 replay 回到 pending。delivering 只是一次尝试的中间态，进程崩溃遗留的 delivering 视为可继续重试。
 */
export interface Delivery {
  readonly id: string;
  readonly eventId: EventId;
  readonly subscriptionId: string;
  readonly serviceId: ServiceId;
  readonly projectId: ProjectId;
  readonly eventType: string;
  readonly state: DeliveryState;
  /** 已开始的尝试次数；信封里的 attempt 就是它。 */
  readonly attempts: number;
  readonly nextAttemptAt?: Date;
  readonly lastError?: string;
  readonly traceId: TraceId;
  readonly deliveredAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const RESUMABLE: readonly DeliveryState[] = ['pending', 'retrying', 'delivering'];

export function newDelivery(
  id: string, event: { id: EventId; eventType: string; traceId: TraceId },
  subscription: { id: string; serviceId: ServiceId; projectId: ProjectId }, now: Date,
): Delivery {
  return {
    id, eventId: event.id, subscriptionId: subscription.id, serviceId: subscription.serviceId, projectId: subscription.projectId,
    eventType: event.eventType, state: 'pending', attempts: 0, nextAttemptAt: now, traceId: event.traceId, createdAt: now, updatedAt: now,
  };
}

export function beginAttempt(delivery: Delivery, now: Date): Delivery {
  if (!RESUMABLE.includes(delivery.state)) throw precondition(`投递 ${delivery.id} 处于 ${delivery.state}，不能再次尝试`, { state: delivery.state });
  return { ...delivery, state: 'delivering', attempts: delivery.attempts + 1, nextAttemptAt: undefined, updatedAt: now };
}

export function markDelivered(delivery: Delivery, now: Date): Delivery {
  return { ...delivery, state: 'delivered', nextAttemptAt: undefined, lastError: undefined, deliveredAt: now, updatedAt: now };
}

/** 未达上限则按退避进入 retrying，否则 dead。 */
export function markFailed(delivery: Delivery, error: string, now: Date, maxAttempts: number, random?: () => number): Delivery {
  if (delivery.attempts >= maxAttempts) return markDead(delivery, error, now);
  const nextAttemptAt = new Date(now.getTime() + backoffSeconds(delivery.attempts, random) * 1000);
  return { ...delivery, state: 'retrying', nextAttemptAt, lastError: error, updatedAt: now };
}

export function markDead(delivery: Delivery, error: string, now: Date): Delivery {
  return { ...delivery, state: 'dead', nextAttemptAt: undefined, lastError: error, updatedAt: now };
}

/** 死信重放：回到 pending 并从第一次尝试重新计数。 */
export function replayDelivery(delivery: Delivery, now: Date): Delivery {
  if (delivery.state !== 'dead') throw precondition(`只有 dead 的投递可以重放，当前为 ${delivery.state}`, { state: delivery.state });
  return { ...delivery, state: 'pending', attempts: 0, nextAttemptAt: now, lastError: undefined, updatedAt: now };
}
