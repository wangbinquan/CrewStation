import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, MANAGED_BY, Resources } from '@crewstation/k8s';
import type { Logger } from '@crewstation/kernel';
import { isPlatformError } from '@crewstation/kernel';
import { createInformer, createWorkQueue } from '@crewstation/resource-runtime';
import type { ClusterWriter, Ensured, ManagedObjectFeed, ManagedObjectReader, ObjectChange, ObservedKind } from '../../ports/cluster';
import { objectCovered } from './coverage';
import { jobSecretObject, releaseJobObject } from './jobObjects';
import { middlewareObject } from './middlewareObjects';
import { namespaceObjectOf, networkPolicyObjectOf, quotaObjectOf } from './namespaceObjects';
import { routeObject } from './routeObjects';
import { slotSecretObject, slotWorkloadObjects } from './slotObjects';
import { checkoutSecretObject, runnerSecretObject, volumeObject, workloadPodObject, workloadPreviewObjects } from './workloadObjects';

const SELECTOR = `${LABELS.managedBy}=${MANAGED_BY}`;
const KINDS: readonly ObservedKind[] = ['Pod', 'PersistentVolumeClaim', 'Secret', 'Service', 'IngressRoute', 'Deployment', 'Job', 'Middleware', 'Namespace', 'ResourceQuota', 'NetworkPolicy'];

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
 * 不是它要删的，也算完成——下一轮按新的观测再判断。路由、中间件、命名空间、额度与网络策略按期望渲染，与观测到的一致就不写，
 * 否则服务端 apply（同一字段管理者）。
 */
/**
 * 按名字建一个不可改的对象（Pod、PVC、不可变 Secret，RFC-025 I25）：先向 API Server 读，在就返回它的 UID；不在才建（render 在这时才调，
 * Runner Secret 的内容就是这时才向所属模块要）。建时撞上同名的（上一轮建成了、回执丢了）按已在处理。
 */
async function ensureNamed(k8s: K8sClient, kind: ObservedKind, target: { readonly namespace: string; readonly name: string }, render: () => Promise<K8sObject> | K8sObject): Promise<Ensured> {
  const found = await k8s.get<K8sObject>(Resources[kind]!, target.name, target.namespace);
  if (found?.metadata.uid) return { uid: found.metadata.uid, created: false };
  try {
    const created = await k8s.create(await render());
    return { uid: created.metadata.uid!, created: true };
  } catch (error) {
    if (!isPlatformError(error) || error.kind !== 'conflict') throw error;
    const existing = await k8s.get<K8sObject>(Resources[kind]!, target.name, target.namespace);
    if (!existing?.metadata.uid) throw error;
    return { uid: existing.metadata.uid, created: false };
  }
}

export function kubernetesClusterWriter(k8s: K8sClient): ClusterWriter {
  const apply = async (desired: K8sObject, current: Parameters<typeof objectCovered>[0]): Promise<'applied' | 'unchanged'> => {
    if (objectCovered(current, desired)) return 'unchanged';
    await k8s.apply(desired);
    return 'applied';
  };
  return {
    remove: async ({ kind, namespace, name, uid }) => {
      try { await k8s.delete(Resources[kind]!, name, namespace, { preconditions: { uid }, ...(kind === 'Pod' ? { gracePeriodSeconds: 30 } : {}) }); }
      catch (error) { if (!isPlatformError(error) || error.kind !== 'conflict') throw error; }
    },
    applyRoute: (route, current) => apply(routeObject(route), current),
    applyMiddleware: (middleware, resourceId, current) => apply(middlewareObject(middleware, resourceId), current),
    applyNamespace: (namespace, current) => apply(namespaceObjectOf(namespace), current),
    applyQuota: (namespace, current) => apply(quotaObjectOf(namespace), current),
    applyNetworkPolicy: (policy, current) => apply(networkPolicyObjectOf(policy), current),
    ensurePod: (pod) => ensureNamed(k8s, 'Pod', pod, () => workloadPodObject(pod)),
    ensureRunnerSecret: (pod, values) => ensureNamed(k8s, 'Secret', { namespace: pod.namespace, name: pod.secret }, async () => runnerSecretObject(pod, await values())),
    ensureCheckoutSecret: (pod, values) => ensureNamed(k8s, 'Secret', { namespace: pod.namespace, name: pod.checkout!.credentialSecretName }, async () => checkoutSecretObject(pod, await values())),
    ensureVolume: (volume) => ensureNamed(k8s, 'PersistentVolumeClaim', volume, () => volumeObject(volume)),
    applyPreview: async (preview, current) => {
      const [service, route] = workloadPreviewObjects(preview);
      const outcomes = [await apply(service!, current.service), ...(route ? [await apply(route, current.route)] : [])];
      return outcomes.includes('applied') ? 'applied' : 'unchanged';
    },
    ensureSlotSecret: (slot, values) => ensureNamed(k8s, 'Secret', { namespace: slot.namespace, name: slot.secret }, async () => slotSecretObject(slot, await values())),
    applySlotService: (slot, current) => apply(slotWorkloadObjects(slot, 0)[1], current),
    applySlotDeployment: (slot, generation, current) => apply(slotWorkloadObjects(slot, generation)[0], current),
    dryRunSlot: async (slot, generation, values) => {
      for (const object of [slotSecretObject(slot, values), ...slotWorkloadObjects(slot, generation)]) await k8s.apply(object, { dryRun: true });
    },
    ensureJobSecret: (job, values) => ensureNamed(k8s, 'Secret', { namespace: job.namespace, name: job.secret }, async () => jobSecretObject(job, await values())),
    ensureJob: (job) => ensureNamed(k8s, 'Job', job, () => releaseJobObject(job)),
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
