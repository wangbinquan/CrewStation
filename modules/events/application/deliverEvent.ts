import type { EventDelivery } from '@crewstation/contracts';
import { EVENT_HEADERS, IDENTITY_HEADERS } from '@crewstation/contracts';
import type { DeliverOutcome } from '../api/moduleApi';
import type { Delivery } from '../domain/delivery';
import { beginAttempt, holdDelivery, markDead, markDelivered, markFailed } from '../domain/delivery';
import type { InboxEvent } from '../domain/inboxEvent';
import type { EventsUseCaseDeps } from './dependencies';

/**
 * 一次投递尝试：定位订阅方 active 槽 → 经服务域 POST 信封 → 2xx 记 delivered；
 * 失败按退避进入 retrying，超过上限 dead；订阅或事件已不存在时直接 dead。HTTP 调用在事务之外。
 */
export function deliverEventUseCase({ uow, endpoints, pusher, settings, clock, hold }: EventsUseCaseDeps) {
  const settle = async (attempt: Delivery, error: string, fatal: boolean): Promise<DeliverOutcome> => {
    const now = clock.now();
    const next = fatal ? markDead(attempt, error, now) : markFailed(attempt, error, now, settings.maxAttempts);
    await uow.run((scope) => scope.deliveries.update(next));
    return { state: next.state, error };
  };
  return async (deliveryId: string): Promise<DeliverOutcome> => {
    const delivery = await uow.read.deliveries.getById(deliveryId);
    if (!delivery) return { state: 'dead', error: `投递 ${deliveryId} 不存在` };
    if (delivery.state === 'delivered' || delivery.state === 'dead' || delivery.state === 'held') return { state: delivery.state };
    // 订阅方正式版本维护中且事件开关打开（RFC-021 M6）：暂存，不开始尝试，队列任务正常完成。
    if (await hold.holds(delivery.serviceId)) {
      await uow.run((scope) => scope.deliveries.update(holdDelivery(delivery, clock.now())));
      return { state: 'held' };
    }
    const attempt = beginAttempt(delivery, clock.now());
    await uow.run((scope) => scope.deliveries.update(attempt));
    const subscription = await uow.read.subscriptions.getById(attempt.subscriptionId);
    if (!subscription) return settle(attempt, '订阅已被移除', true);
    if (subscription.state !== 'active') return settle(attempt, '订阅已暂停', false);
    const endpoint = await endpoints.resolve(attempt.serviceId);
    if (!endpoint) return settle(attempt, '订阅方没有 active 槽', false);
    const event = await uow.read.inbox.getById(attempt.eventId);
    if (!event) return settle(attempt, `事件 ${attempt.eventId} 不存在`, true);
    const url = `${endpoint.baseUrl.replace(/\/$/, '')}${subscription.handlerPath}`;
    const result = await pusher.push(url, envelope(event, attempt), headersFor(attempt));
    if (!result.ok) return settle(attempt, result.error ?? `HTTP ${result.status}`, false);
    await uow.run((scope) => scope.deliveries.update(markDelivered(attempt, clock.now())));
    return { state: 'delivered' };
  };
}

function envelope(event: InboxEvent, attempt: Delivery): EventDelivery {
  return {
    deliveryId: attempt.id,
    eventId: event.id,
    eventTypeId: event.eventTypeId,
    eventType: event.eventType,
    source: { producerId: event.producerId, producer: event.producer, project: event.producerProject },
    occurredAt: event.occurredAt.toISOString(),
    receivedAt: event.receivedAt.toISOString(),
    traceId: event.traceId,
    attempt: attempt.attempts,
    payload: event.payload,
  };
}

/** 来源令牌由网关服务域注入；这里只带事件头与 traceId。 */
function headersFor(attempt: Delivery): Record<string, string> {
  return {
    [EVENT_HEADERS.eventType]: attempt.eventType,
    [EVENT_HEADERS.deliveryId]: attempt.id,
    [EVENT_HEADERS.deliveryAttempt]: String(attempt.attempts),
    [IDENTITY_HEADERS.traceId]: attempt.traceId,
  };
}
