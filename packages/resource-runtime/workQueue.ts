import type { Logger } from '@crewstation/kernel';
import { backoffDelay } from './backoff';

export interface WorkQueueOptions {
  readonly logger: Logger;
  readonly concurrency?: number;
  /** 失败重试的退避（设计 §6.1：指数退避，上限 5 分钟）。 */
  readonly backoff?: { readonly initialMs: number; readonly maxMs: number };
  /** 某个键失败一次时的回调（例如把原因写进条件 ReconcileError）。 */
  onFailure?(key: string, error: unknown, attempts: number): void;
}

export interface WorkQueue {
  /** 排进队列；已在队列里的不重复排，正在处理的处理完再来一遍。 */
  add(key: string): void;
  /** 过一会儿再排；同一个键只保留最早的那次。 */
  addAfter(key: string, ms: number): void;
  start(): void;
  stop(): Promise<void>;
  /** 连续失败的次数；成功一次清零。 */
  failures(key: string): number;
  /** 队列空、没有在处理的键时 resolve（延迟排队的不算）。 */
  drained(): Promise<void>;
  size(): number;
}

interface QueueState {
  readonly order: string[];
  readonly queued: Set<string>;
  readonly processing: Set<string>;
  readonly dirty: Set<string>;
  readonly delayed: Map<string, { readonly at: number; readonly timer: ReturnType<typeof setTimeout> }>;
  readonly failed: Map<string, number>;
  readonly waiters: (() => void)[];
  running: boolean;
}

/**
 * 按资源 ID 去重的工作队列（设计 §6.1）：同一资源在队列里只有一项，同一时刻只有一个处理者；
 * 触发来源（台账变更、观测事件、定时）都只是「把这个 ID 排进来」，处理者每次读最新的期望与观测。
 */
export function createWorkQueue(handler: (key: string) => Promise<void>, options: WorkQueueOptions): WorkQueue {
  const state: QueueState = { order: [], queued: new Set(), processing: new Set(), dirty: new Set(), delayed: new Map(), failed: new Map(), waiters: [], running: false };
  const concurrency = options.concurrency ?? 4;
  const backoff = options.backoff ?? { initialMs: 1_000, maxMs: 300_000 };
  const inFlight = new Set<Promise<void>>();

  const settle = () => {
    if (state.order.length || state.processing.size) return;
    for (const resolve of state.waiters.splice(0)) resolve();
  };

  const add = (key: string) => {
    if (state.processing.has(key)) { state.dirty.add(key); return; }
    if (state.queued.has(key)) return;
    state.queued.add(key);
    state.order.push(key);
    pump();
  };

  const addAfter = (key: string, ms: number) => {
    if (ms <= 0) { add(key); return; }
    const at = Date.now() + ms;
    const existing = state.delayed.get(key);
    if (existing && existing.at <= at) return;
    if (existing) clearTimeout(existing.timer);
    state.delayed.set(key, { at, timer: setTimeout(() => { state.delayed.delete(key); add(key); }, ms) });
  };

  const run = async (key: string) => {
    try {
      await handler(key);
      state.failed.delete(key);
    } catch (error) {
      const attempts = (state.failed.get(key) ?? 0) + 1;
      state.failed.set(key, attempts);
      options.logger.warn('work item failed', { key, attempts, error: String(error) });
      options.onFailure?.(key, error, attempts);
      if (state.running) addAfter(key, backoffDelay(attempts, backoff.initialMs, backoff.maxMs));
    } finally {
      state.processing.delete(key);
      if (state.dirty.delete(key) && state.running) add(key);
      pump();
      settle();
    }
  };

  function pump(): void {
    while (state.running && state.processing.size < concurrency && state.order.length) {
      const key = state.order.shift()!;
      state.queued.delete(key);
      state.processing.add(key);
      const task = run(key);
      inFlight.add(task);
      void task.finally(() => inFlight.delete(task));
    }
  }

  return {
    add,
    addAfter,
    start: () => { state.running = true; pump(); },
    stop: async () => {
      state.running = false;
      for (const { timer } of state.delayed.values()) clearTimeout(timer);
      state.delayed.clear();
      await Promise.all([...inFlight]);
    },
    failures: (key) => state.failed.get(key) ?? 0,
    drained: () => (state.order.length || state.processing.size ? new Promise<void>((resolve) => { state.waiters.push(resolve); }) : Promise.resolve()),
    size: () => state.order.length + state.processing.size,
  };
}
