import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, MANAGED_BY, Resources } from '@crewstation/k8s';
import type { Logger } from '@crewstation/kernel';
import { isPlatformError } from '@crewstation/kernel';
import { createInformer, createWorkQueue } from '@crewstation/resource-runtime';
import type { ClusterWriter, ManagedObjectFeed, ManagedObjectReader, ObjectChange, ObservedKind } from '../../ports/cluster';

const SELECTOR = `${LABELS.managedBy}=${MANAGED_BY}`;
const KINDS: readonly ObservedKind[] = ['Pod', 'PersistentVolumeClaim', 'Secret', 'Service', 'IngressRoute', 'Deployment', 'Job'];

/** Secret 的内容一律不进缓存、不经调和器（设计 §13：只留调和要用的字段）。 */
export function withoutSecretData(obj: K8sObject): K8sObject {
  if (obj.kind !== 'Secret') return obj;
  const { data: _data, stringData: _stringData, ...rest } = obj as K8sObject & { data?: unknown; stringData?: unknown };
  return rest as K8sObject;
}

/** 只观测带 `app.kubernetes.io/managed-by=crewstation` 的对象（设计 §6.1、B7）。 */
export function managedObjectReader(k8s: K8sClient): ManagedObjectReader {
  return { list: async (kind) => (await k8s.list<K8sObject>(Resources[kind]!, undefined, { labelSelector: SELECTOR })).map(withoutSecretData) };
}

/**
 * 调和器的删除：带 UID 前置条件（设计 §6.2）；Pod 给 30 秒优雅退出。对象已经没了算完成；UID 对不上（同名的新对象）
 * 不是它要删的，也算完成——下一轮按新的观测再判断。
 */
export function kubernetesClusterWriter(k8s: K8sClient): ClusterWriter {
  return {
    remove: async ({ kind, namespace, name, uid }) => {
      try { await k8s.delete(Resources[kind]!, name, namespace, { preconditions: { uid }, ...(kind === 'Pod' ? { gracePeriodSeconds: 30 } : {}) }); }
      catch (error) { if (!isPlatformError(error) || error.kind !== 'conflict') throw error; }
    },
  };
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
  const informers = KINDS.map((kind) => createInformer<K8sObject>(k8s, Resources[kind]!, {
    upsert: (object) => note(kind, object, false),
    remove: (object) => note(kind, object, true),
  }, { logger: options.logger, labelSelector: SELECTOR, transform: withoutSecretData, ...(options.relistMs ? { relistMs: options.relistMs } : {}) }));
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
    cached: (kind, namespace, name) => informers[KINDS.indexOf(kind)]?.get(namespace, name),
    list: (kind) => informers[KINDS.indexOf(kind)]?.list() ?? [],
  };
}
