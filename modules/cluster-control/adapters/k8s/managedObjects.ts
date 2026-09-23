import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, MANAGED_BY, Resources } from '@crewstation/k8s';
import type { Logger } from '@crewstation/kernel';
import type { Informer } from '@crewstation/resource-runtime';
import { createInformer, createWorkQueue } from '@crewstation/resource-runtime';
import type { ManagedObjectFeed, ManagedObjectReader, ObjectChange, ObservedKind } from '../../ports/cluster';

const SELECTOR = `${LABELS.managedBy}=${MANAGED_BY}`;
const KINDS: readonly ObservedKind[] = ['Pod', 'PersistentVolumeClaim'];

/** 只观测带 `app.kubernetes.io/managed-by=crewstation` 的对象（设计 §6.1、B7）。 */
export function managedObjectReader(k8s: K8sClient): ManagedObjectReader {
  return { list: (kind) => k8s.list<K8sObject>(Resources[kind]!, undefined, { labelSelector: SELECTOR }) };
}

export interface FeedOptions {
  readonly logger: Logger;
  readonly relistMs?: number;
  readonly concurrency?: number;
}

/**
 * 受管对象的变化流：每个种类一个观测缓存；变化只把对象的键排进去重队列，
 * 处理时取这个键最新的状态（中间态被合并，同一对象不会并发处理）。
 */
export function managedObjectFeed(k8s: K8sClient, options: FeedOptions): ManagedObjectFeed {
  const latest = new Map<string, ObjectChange>();
  let handle: ((change: ObjectChange) => Promise<void>) | undefined;
  const queue = createWorkQueue(async (key) => {
    const change = latest.get(key);
    if (!change || !handle) return;
    latest.delete(key);
    await handle(change);
  }, { logger: options.logger, ...(options.concurrency ? { concurrency: options.concurrency } : {}) });
  const note = (kind: ObservedKind, object: K8sObject, gone: boolean) => {
    const key = `${kind}/${object.metadata.namespace ?? ''}/${object.metadata.name}`;
    latest.set(key, { kind, object, gone });
    queue.add(key);
  };
  const informers: Informer<K8sObject>[] = KINDS.map((kind) => createInformer<K8sObject>(k8s, Resources[kind]!, {
    upsert: (object) => note(kind, object, false),
    remove: (object) => note(kind, object, true),
  }, { logger: options.logger, labelSelector: SELECTOR, ...(options.relistMs ? { relistMs: options.relistMs } : {}) }));
  return {
    start: (next) => {
      handle = next;
      queue.start();
      for (const informer of informers) informer.start();
    },
    stop: async () => {
      await Promise.all(informers.map((informer) => informer.stop()));
      await queue.stop();
    },
    // 全量完成之后，还要等全量带进来的变化都处理完，汇总才反映真实的首轮结果。
    synced: async () => { await Promise.all(informers.map((informer) => informer.synced())); await queue.drained(); },
  };
}
