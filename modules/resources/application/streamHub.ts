import type { ResourceCounts, ResourceStreamEvent } from '@crewstation/contracts';
import type { Clock, Logger } from '@crewstation/kernel';
import { quotaExceeded } from '@crewstation/kernel';
import type { StreamSubscription, ViewerAccess } from '../api/types';
import type { LedgerRecord, RecordFilter } from '../domain/record';
import type { ChangeEntry, LedgerScope } from '../ports/repositories';
import type { Subscriber, SubscriberHost } from './streamSubscriber';
import { dropSubscriber, enqueueEvent, goLive, newSubscriber, resetSubscriber } from './streamSubscriber';
import { readView, toResourceRecord } from './views';

export interface StreamOptions {
  readonly pollMs: number;
  readonly heartbeatMs: number;
  /** 空闲的流多久复核一次授权。 */
  readonly reauthorizeMs: number;
  /** 发事件前复核授权的最短间隔。 */
  readonly recheckMs: number;
  readonly bufferLimit: number;
  readonly perUserLimit: number;
}

export const DEFAULT_STREAM_OPTIONS: StreamOptions = { pollMs: 250, heartbeatMs: 15_000, reauthorizeMs: 60_000, recheckMs: 5_000, bufferLimit: 256, perUserLimit: 8 };

const PAGE = 500;

interface HubState extends SubscriberHost {
  readonly read: LedgerScope;
  readonly clock: Clock;
  readonly options: StreamOptions;
  readonly subscribers: Set<Subscriber>;
  cursor?: number;
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
}

function matches(filter: RecordFilter, record: Pick<LedgerRecord, 'projectId' | 'kind' | 'parentId'>): boolean {
  return (!filter.projectId || record.projectId === filter.projectId) && (!filter.kind || record.kind === filter.kind) && (!filter.parentId || record.parentId === filter.parentId);
}

const filterKey = (filter: RecordFilter): string => JSON.stringify([filter.projectId ?? null, filter.kind ?? null, filter.parentId ?? null, !!filter.includeStopped]);

/** 一条变更对一个订阅意味着什么：不相干（undefined）、移除、或最新的标准记录。 */
function eventFor(entry: ChangeEntry, record: LedgerRecord | undefined, filter: RecordFilter, access: ViewerAccess, counts: ResourceCounts, now: Date): ResourceStreamEvent | undefined {
  if (filter.projectId && entry.projectId !== filter.projectId) return undefined;
  if (record && !matches(filter, record)) return undefined;
  if (!record || entry.change === 'remove' || record.compactedAt) return { type: 'remove', id: entry.resourceId, counts, cursor: entry.seq };
  return { type: 'upsert', record: toResourceRecord(record, now, access), counts, cursor: entry.seq };
}

/** 同一批里一条资源只发最后一次（带那次的游标）；按游标升序。 */
function latestPerResource(batch: readonly ChangeEntry[]): ChangeEntry[] {
  const latest = new Map<string, ChangeEntry>();
  for (const entry of batch) latest.set(entry.resourceId, entry);
  return [...latest.values()].sort((a, b) => a.seq - b.seq);
}

async function dispatch(state: HubState, batch: readonly ChangeEntry[]): Promise<void> {
  const entries = latestPerResource(batch);
  const records = new Map((await state.read.records.getMany(entries.map((entry) => entry.resourceId))).map((record) => [record.id, record]));
  const counts = new Map<string, Promise<ResourceCounts>>();
  const countsFor = (filter: RecordFilter) => {
    const key = filterKey(filter);
    if (!counts.has(key)) counts.set(key, state.read.records.countByKindPhase(filter));
    return counts.get(key)!;
  };
  const now = state.clock.now();
  for (const entry of entries) {
    for (const subscriber of state.subscribers) {
      const { filter, access } = subscriber.subscription;
      if (filter.projectId && entry.projectId !== filter.projectId) continue;
      const event = eventFor(entry, records.get(entry.resourceId), filter, access, await countsFor(filter), now);
      if (event) enqueueEvent(state, subscriber, event);
    }
  }
}

async function tick(state: HubState): Promise<void> {
  state.timer = undefined;
  if (!state.running) return;
  let delay = state.options.pollMs;
  try {
    state.cursor ??= await state.read.changes.latest();
    const batch = await state.read.changes.since(state.cursor, PAGE);
    if (batch.length) {
      state.cursor = batch.at(-1)!.seq;
      if (state.subscribers.size) await dispatch(state, batch);
      if (batch.length === PAGE) delay = 0;
    }
  } catch (error) {
    state.logger.warn('resource stream tail failed', { error: String(error) });
    delay = Math.max(1_000, state.options.pollMs);
  }
  if (state.running) state.timer = setTimeout(() => void tick(state), delay);
}

/** 续传：客户端游标之后的变更都还在保留期里，就逐条补发；否则（或游标比日志还新）给快照（设计 §8.1）。 */
async function initialEvents(state: HubState, subscription: StreamSubscription): Promise<{ readonly events: ResourceStreamEvent[]; readonly floor: number }> {
  const { filter, access, cursor } = subscription;
  const [earliest, latest] = [await state.read.changes.earliest(), await state.read.changes.latest()];
  if (cursor === undefined || cursor + 1 < earliest || cursor > latest) {
    const view = await readView(state.read, filter, access, state.clock.now());
    return { events: [{ type: 'snapshot', ...view }], floor: view.cursor };
  }
  const replay: ChangeEntry[] = [];
  for (let from = cursor; from < latest;) {
    const page = await state.read.changes.since(from, PAGE, filter.projectId);
    if (!page.length) break;
    replay.push(...page.filter((entry) => entry.seq <= latest));
    from = page.at(-1)!.seq;
  }
  const entries = latestPerResource(replay);
  const records = new Map((await state.read.records.getMany(entries.map((entry) => entry.resourceId))).map((record) => [record.id, record]));
  const counts = await state.read.records.countByKindPhase(filter);
  const now = state.clock.now();
  const events = entries.map((entry) => eventFor(entry, records.get(entry.resourceId), filter, access, counts, now)).filter((event): event is ResourceStreamEvent => !!event);
  return { events, floor: cursor };
}

function checkCapacity(state: HubState, userId: string): void {
  const mine = [...state.subscribers].filter((s) => s.subscription.userId === userId).length;
  if (mine >= state.options.perUserLimit) throw quotaExceeded(`同时打开的资源推送流已达上限 ${state.options.perUserLimit}`, { limit: state.options.perUserLimit });
}

async function subscribe(state: HubState, subscription: StreamSubscription): Promise<{ close(): void }> {
  checkCapacity(state, subscription.userId);
  const subscriber = newSubscriber(subscription);
  state.subscribers.add(subscriber);
  try {
    const start = await initialEvents(state, subscription);
    subscriber.lastSent = start.floor;
    goLive(state, subscriber, start.events);
  } catch (error) {
    dropSubscriber(state, subscriber);
    throw error;
  }
  subscriber.timers.push(setInterval(() => enqueueEvent(state, subscriber, { type: 'heartbeat', at: state.clock.now().toISOString() }), state.options.heartbeatMs));
  subscriber.timers.push(setInterval(() => {
    void subscription.reauthorize().then(() => { subscriber.authorizedAt = Date.now(); }, () => resetSubscriber(state, subscriber, 'forbidden'));
  }, state.options.reauthorizeMs));
  return { close: () => dropSubscriber(state, subscriber) };
}

/**
 * 每个 cs-api 副本一个尾随器（设计 §8.2）：按 seq 递增读变更日志，按订阅的过滤条件分发。
 * 序号按提交顺序盖章（迁移里的延迟触发器），所以按 seq 读不会漏掉晚提交的早序号。
 */
export function createStreamHub(read: LedgerScope, clock: Clock, logger: Logger, options: StreamOptions = DEFAULT_STREAM_OPTIONS) {
  const subscribers = new Set<Subscriber>();
  const state: HubState = { read, clock, logger, options, subscribers, running: false, bufferLimit: options.bufferLimit, recheckMs: options.recheckMs, forget: (subscriber) => subscribers.delete(subscriber) };
  return {
    start: () => { if (state.running) return; state.running = true; void tick(state); },
    stop: async () => {
      state.running = false;
      if (state.timer) clearTimeout(state.timer);
      state.timer = undefined;
      for (const subscriber of [...subscribers]) dropSubscriber(state, subscriber);
    },
    subscriberCount: () => subscribers.size,
    checkCapacity: (userId: string) => checkCapacity(state, userId),
    subscribe: (subscription: StreamSubscription) => subscribe(state, subscription),
  };
}

export type StreamHub = ReturnType<typeof createStreamHub>;
