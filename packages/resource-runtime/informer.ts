import type { K8sClient, K8sObject, ResourceRef } from '@crewstation/k8s';
import type { Logger } from '@crewstation/kernel';
import { abortableSleep, backoffDelay } from './backoff';

/** 观测缓存的回调：对象出现或变化、对象消失。回调里不要做慢事，慢事交给工作队列。 */
export interface InformerEvents<T> {
  upsert(obj: T): void;
  remove(obj: T): void;
}

export interface InformerOptions {
  readonly logger: Logger;
  readonly labelSelector?: string;
  readonly namespace?: string;
  /** 全量核对周期（设计 §6.1：10 分钟一次纠偏）。 */
  readonly relistMs?: number;
  readonly watchTimeoutSeconds?: number;
  readonly pageSize?: number;
  readonly backoff?: { readonly initialMs: number; readonly maxMs: number };
  readonly now?: () => number;
}

export interface Informer<T> {
  start(): void;
  stop(): Promise<void>;
  /** 第一次全量完成后 resolve：此前缓存不完整，不能据它判断「对象不存在」。 */
  synced(): Promise<void>;
  get(namespace: string | undefined, name: string): T | undefined;
  list(): T[];
  /** 最近一次与 API Server 成功往来的时刻；集群不可达时它停在过去（设计 §12：观测暂不可用）。 */
  lastContact(): number | undefined;
}

const keyOf = (obj: K8sObject): string => `${obj.metadata.namespace ?? ''}/${obj.metadata.name}`;

interface InformerState<T extends K8sObject> {
  readonly cache: Map<string, T>;
  running: boolean;
  controller: AbortController;
  contact?: number;
  markSynced(): void;
}

/** 全量：分页 list，缓存换成这一份；新的与变了的报 upsert，没列到的报 remove。返回续 watch 的 resourceVersion。 */
async function relist<T extends K8sObject>(k8s: K8sClient, ref: ResourceRef, events: InformerEvents<T>, options: InformerOptions, state: InformerState<T>): Promise<string> {
  const seen = new Map<string, T>();
  let resourceVersion = '';
  let next: string | undefined;
  do {
    const page = await k8s.listPage<T>(ref, options.namespace, { ...(options.labelSelector ? { labelSelector: options.labelSelector } : {}), limit: options.pageSize ?? 500, ...(next ? { continue: next } : {}), signal: state.controller.signal });
    for (const item of page.items) seen.set(keyOf(item), item);
    resourceVersion = page.resourceVersion;
    next = page.continue || undefined;
  } while (next);
  state.contact = (options.now ?? Date.now)();
  for (const [key, obj] of seen) {
    const previous = state.cache.get(key);
    state.cache.set(key, obj);
    if (!previous || previous.metadata.resourceVersion !== obj.metadata.resourceVersion) events.upsert(obj);
  }
  for (const [key, obj] of [...state.cache]) {
    if (seen.has(key)) continue;
    state.cache.delete(key);
    events.remove(obj);
  }
  return resourceVersion;
}

/** 一次 watch：到超时正常结束返回最新 resourceVersion；410（版本已过期）返回 undefined，要求重新全量。 */
async function watchOnce<T extends K8sObject>(k8s: K8sClient, ref: ResourceRef, events: InformerEvents<T>, options: InformerOptions, state: InformerState<T>, from: string): Promise<string | undefined> {
  let resourceVersion = from;
  let expired = false;
  const attempt = new AbortController();
  const signal = AbortSignal.any([state.controller.signal, attempt.signal]);
  await k8s.watch<T>(ref, options.namespace, { ...(options.labelSelector ? { labelSelector: options.labelSelector } : {}), resourceVersion: from, timeoutSeconds: options.watchTimeoutSeconds ?? 300, signal }, (type, obj) => {
    state.contact = (options.now ?? Date.now)();
    if (type === 'ERROR') {
      expired = true;
      attempt.abort();
      return;
    }
    resourceVersion = obj.metadata.resourceVersion ?? resourceVersion;
    if (type === 'BOOKMARK') return;
    const key = keyOf(obj);
    if (type === 'DELETED') {
      state.cache.delete(key);
      events.remove(obj);
      return;
    }
    state.cache.set(key, obj);
    events.upsert(obj);
  });
  return expired ? undefined : resourceVersion;
}

async function loop<T extends K8sObject>(k8s: K8sClient, ref: ResourceRef, events: InformerEvents<T>, options: InformerOptions, state: InformerState<T>): Promise<void> {
  const now = options.now ?? Date.now;
  const backoff = options.backoff ?? { initialMs: 1_000, maxMs: 30_000 };
  let failures = 0;
  while (state.running) {
    try {
      let resourceVersion: string | undefined = await relist(k8s, ref, events, options, state);
      state.markSynced();
      failures = 0;
      const relistAt = now() + (options.relistMs ?? 600_000);
      while (state.running && resourceVersion !== undefined && now() < relistAt) resourceVersion = await watchOnce(k8s, ref, events, options, state, resourceVersion);
    } catch (error) {
      if (!state.running) break;
      failures += 1;
      const delay = backoffDelay(failures, backoff.initialMs, backoff.maxMs);
      options.logger.warn('informer interrupted', { kind: ref.kind, error: String(error), retryMs: delay });
      await abortableSleep(delay, state.controller.signal);
    }
  }
}

/**
 * 按种类的观测缓存（设计 §6.1）：list 全量后从它的 resourceVersion 续 watch（带书签），
 * 版本过期（410）或到了全量核对周期就重新 list；出错按指数退避重连。
 */
export function createInformer<T extends K8sObject>(k8s: K8sClient, ref: ResourceRef, events: InformerEvents<T>, options: InformerOptions): Informer<T> {
  let resolveSynced!: () => void;
  const syncedOnce = new Promise<void>((resolve) => { resolveSynced = resolve; });
  const state: InformerState<T> = { cache: new Map(), running: false, controller: new AbortController(), markSynced: () => resolveSynced() };
  let running: Promise<void> | undefined;
  return {
    start: () => {
      if (state.running) return;
      state.running = true;
      state.controller = new AbortController();
      running = loop(k8s, ref, events, options, state);
    },
    stop: async () => {
      state.running = false;
      state.controller.abort();
      await running;
    },
    synced: () => syncedOnce,
    get: (namespace, name) => state.cache.get(`${namespace ?? ''}/${name}`),
    list: () => [...state.cache.values()],
    lastContact: () => state.contact,
  };
}
