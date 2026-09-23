import type { ResourceStreamEvent } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { StreamSubscription } from '../api/types';

/**
 * 订阅在服务端的状态。登记后先是「追赶」：快照或续传算好之前，尾随器送来的实时变更进 pending；
 * 追赶完成转为「实时」：pending 里游标更新的事件放行，此后按游标去重、按上限排队。
 */
export interface Subscriber {
  readonly subscription: StreamSubscription;
  readonly queue: ResourceStreamEvent[];
  readonly pending: ResourceStreamEvent[];
  /** 已排进队列的最大游标；不大于它的变更（快照或续传已含）丢弃。 */
  lastSent: number;
  live: boolean;
  overflowed: boolean;
  /** 已排进 reset：此后不再收事件，reset 发出即断开。 */
  resetting: boolean;
  pumping: boolean;
  closed: boolean;
  /** 最近一次授权通过的时刻（毫秒）；发事件前按 recheckMs 复核。 */
  authorizedAt: number;
  readonly timers: ReturnType<typeof setInterval>[];
}

export interface SubscriberHost {
  readonly bufferLimit: number;
  /** 发事件前复核授权的最短间隔：与 cs-session 的会话流一样，失权后不再把任何事件发给这个连接。 */
  readonly recheckMs: number;
  readonly logger: Logger;
  forget(subscriber: Subscriber): void;
}

export function newSubscriber(subscription: StreamSubscription): Subscriber {
  return { subscription, queue: [], pending: [], lastSent: -1, live: false, overflowed: false, resetting: false, pumping: false, closed: false, authorizedAt: Date.now(), timers: [] };
}

export const eventCursor = (event: ResourceStreamEvent): number | undefined => ('cursor' in event ? event.cursor : undefined);

export function dropSubscriber(host: SubscriberHost, subscriber: Subscriber): void {
  if (subscriber.closed) return;
  subscriber.closed = true;
  subscriber.timers.forEach(clearInterval);
  host.forget(subscriber);
  subscriber.subscription.close();
}

/** 带资源内容的事件发出前复核授权（至多每 recheckMs 一次）；复核不过或出错都按失权处理（fail closed）。 */
async function stillAuthorized(host: SubscriberHost, subscriber: Subscriber, event: ResourceStreamEvent): Promise<boolean> {
  if (event.type === 'reset' || event.type === 'heartbeat' || Date.now() - subscriber.authorizedAt < host.recheckMs) return true;
  try {
    await subscriber.subscription.reauthorize();
    subscriber.authorizedAt = Date.now();
    return true;
  } catch {
    return false;
  }
}

export async function pumpSubscriber(host: SubscriberHost, subscriber: Subscriber): Promise<void> {
  if (subscriber.pumping) return;
  subscriber.pumping = true;
  try {
    while (!subscriber.closed && subscriber.live && subscriber.queue.length) {
      const event = subscriber.queue.shift()!;
      if (!(await stillAuthorized(host, subscriber, event))) {
        subscriber.queue.length = 0;
        subscriber.resetting = true;
        await subscriber.subscription.send({ type: 'reset', reason: 'forbidden' });
        dropSubscriber(host, subscriber);
        break;
      }
      await subscriber.subscription.send(event);
      if (event.type === 'reset') dropSubscriber(host, subscriber);
    }
  } catch (error) {
    host.logger.info('resource stream send failed', { error: String(error) });
    dropSubscriber(host, subscriber);
  } finally {
    subscriber.pumping = false;
  }
}

/** 只发一个 reset 就断开：慢客户端、失权的连接都这样收尾，客户端重连拿快照（或拿到 403）。 */
export function resetSubscriber(host: SubscriberHost, subscriber: Subscriber, reason: string): void {
  if (subscriber.closed || subscriber.resetting) return;
  subscriber.resetting = true;
  subscriber.queue.length = 0;
  subscriber.pending.length = 0;
  subscriber.queue.push({ type: 'reset', reason });
  subscriber.live = true;
  // 正在写的那一帧写完后，写出循环接着发的就是 reset。
  void pumpSubscriber(host, subscriber);
}

export function enqueueEvent(host: SubscriberHost, subscriber: Subscriber, event: ResourceStreamEvent): void {
  if (subscriber.closed || subscriber.resetting) return;
  if (!subscriber.live) {
    subscriber.pending.push(event);
    if (subscriber.pending.length > host.bufferLimit) subscriber.overflowed = true;
    return;
  }
  const at = eventCursor(event);
  if (at !== undefined) {
    if (at <= subscriber.lastSent) return;
    subscriber.lastSent = at;
  }
  if (subscriber.queue.length >= host.bufferLimit) {
    resetSubscriber(host, subscriber, 'buffer-overflow');
    return;
  }
  subscriber.queue.push(event);
  void pumpSubscriber(host, subscriber);
}

/** 追赶完成：先排初始事件（快照或续传），再放行追赶期间缓冲的实时变更。 */
export function goLive(host: SubscriberHost, subscriber: Subscriber, initial: readonly ResourceStreamEvent[]): void {
  if (subscriber.closed || subscriber.resetting) return;
  const pending = subscriber.pending.splice(0);
  subscriber.queue.push(...initial);
  subscriber.lastSent = Math.max(subscriber.lastSent, ...initial.map((event) => eventCursor(event) ?? -1));
  subscriber.live = true;
  if (subscriber.overflowed) {
    resetSubscriber(host, subscriber, 'buffer-overflow');
    return;
  }
  for (const event of pending) enqueueEvent(host, subscriber, event);
  void pumpSubscriber(host, subscriber);
}
