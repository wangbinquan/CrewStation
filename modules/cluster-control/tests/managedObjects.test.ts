import { describe, expect, test } from 'bun:test';
import type { K8sClient, K8sObject, WatchEventType } from '@crewstation/k8s';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { conflict, newResourceId, noopLogger } from '@crewstation/kernel';
import { DEVELOPMENT_REMOVAL_ANNOTATION, TaskIdSchema, WORKLOAD_CONSUMER_ANNOTATION, WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import type { WorkloadStopProof } from '@crewstation/contracts';
import { guardedClusterWriter } from '../adapters/k8s/developmentGuard';
import { kubernetesClusterWriter, managedObjectFeed, managedObjectReader } from '../adapters/k8s/managedObjects';
import type { LedgerObservations, LedgerRecordView } from '../ports/ledger';
import { createClusterControlModule } from '../wiring';
import { reconcileRecord } from '../application/reconcileObservations';
import { newObservationStats } from '../application/observeChange';
import type { ObjectChange } from '../ports/cluster';

const managed = { 'app.kubernetes.io/managed-by': 'crewstation' };
const object = (kind: string, name: string, rv: string, labels: Record<string, string> = managed): K8sObject => ({ apiVersion: 'v1', kind, metadata: { name, namespace: 'cs-demo', uid: `uid-${name}`, resourceVersion: rv, labels } });

describe('受管对象的列表与变化流（设计 §6.1）', () => {
  test('一次性列表只要带受管标签的对象；Secret 的内容不带出来', async () => {
    const k8s = createFakeK8sClient();
    await k8s.apply(object('Pod', 'mine', '1'));
    await k8s.apply(object('Pod', 'not-mine', '1', {}));
    await k8s.apply(object('PersistentVolumeClaim', 'work', '1'));
    await k8s.apply({ ...object('Secret', 'task-1-runner', '1'), data: { CS_RUNNER_TOKEN: 'c2VjcmV0' } });
    const reader = managedObjectReader(k8s);
    expect((await reader.list('Pod')).map((o) => o.metadata.name)).toEqual(['mine']);
    expect((await reader.list('PersistentVolumeClaim')).map((o) => o.metadata.name)).toEqual(['work']);
    const secrets = await reader.list('Secret');
    expect(secrets.map((o) => o.metadata.name)).toEqual(['task-1-runner']); expect(JSON.stringify(secrets)).not.toContain('c2VjcmV0');
  });

  test('调和器的删除带 UID 前置条件：对象没了与换了实例都算完成，别的错误照抛', async () => {
    const k8s = createFakeK8sClient();
    await k8s.apply(object('Pod', 'task-1', '1'));
    const writer = kubernetesClusterWriter(k8s);
    await writer.remove({ kind: 'Pod', namespace: 'cs-demo', name: 'task-1', uid: 'uid-other' });
    expect(await k8s.get(Resources.Pod!, 'task-1', 'cs-demo')).toBeDefined();
    await writer.remove({ kind: 'Pod', namespace: 'cs-demo', name: 'task-1', uid: 'uid-task-1' });
    expect(await k8s.get(Resources.Pod!, 'task-1', 'cs-demo')).toBeUndefined();
    await writer.remove({ kind: 'Secret', namespace: 'cs-demo', name: 'gone', uid: 'uid-gone' });
    const failing = kubernetesClusterWriter({ ...k8s, delete: async () => { throw new Error('API Server 不可用'); } });
    await expect(failing.remove({ kind: 'Service', namespace: 'cs-demo', name: 'x', uid: 'u' })).rejects.toThrow('API Server 不可用');
  });

  test('全量与 watch 的变化按对象去重后逐个交给处理者，删除带 gone', async () => {
    const selectors: string[] = [];
    const scripts: Record<string, { type: WatchEventType; object: K8sObject }[]> = {
      Pod: [{ type: 'MODIFIED', object: object('Pod', 'a', '5') }, { type: 'DELETED', object: object('Pod', 'a', '6') }],
      PersistentVolumeClaim: [], Secret: [{ type: 'ADDED', object: { ...object('Secret', 's', '3'), data: { token: 'c2VjcmV0' } } }], Service: [], IngressRoute: [], Deployment: [], Job: [], Middleware: [],
      Namespace: [], ResourceQuota: [{ type: 'MODIFIED', object: object('ResourceQuota', 'crewstation-project', '4') }], NetworkPolicy: [],
    };
    // 命名空间是集群级对象：不带命名空间，按名字进缓存。
    const namespace: K8sObject = { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'cs-demo', uid: 'uid-ns', resourceVersion: '1', labels: managed } };
    const lists: Record<string, K8sObject[]> = {
      Pod: [object('Pod', 'a', '1')], PersistentVolumeClaim: [object('PersistentVolumeClaim', 'w', '1')], Secret: [], Service: [object('Service', 'task-1', '1')], IngressRoute: [], Deployment: [object('Deployment', 'demo-green', '1')],
      Job: [object('Job', 'build-1', '1')], Middleware: [object('Middleware', 'rate-limit-user', '1')], Namespace: [namespace], ResourceQuota: [object('ResourceQuota', 'crewstation-project', '1')], NetworkPolicy: [object('NetworkPolicy', 'crewstation-default', '1')],
    };
    const k8s = {
      listPage: async (ref: { kind: string }, _ns: unknown, options: { labelSelector?: string }) => {
        selectors.push(options.labelSelector ?? '');
        return { items: lists[ref.kind]!, resourceVersion: '2', continue: '' };
      },
      watch: async (ref: { kind: string }, _ns: unknown, options: { signal?: AbortSignal }, onEvent: (type: WatchEventType, obj: K8sObject) => void) => {
        for (const event of scripts[ref.kind]!.splice(0)) onEvent(event.type, event.object);
        await new Promise<void>((resolve) => options.signal?.addEventListener('abort', () => resolve(), { once: true }));
      },
    } as unknown as K8sClient;
    const seen: ObjectChange[] = [];
    const feed = managedObjectFeed(k8s, { logger: noopLogger });
    feed.start(async (change) => { seen.push(change); });
    await feed.synced();
    const deadline = Date.now() + 2_000;
    while (!seen.some((c) => c.gone) && Date.now() < deadline) await Bun.sleep(5);
    await feed.stop();
    expect(selectors).toEqual(Array.from({ length: 11 }, () => 'app.kubernetes.io/managed-by=crewstation'));
    expect(seen.some((c) => c.kind === 'Middleware' && c.object.metadata.name === 'rate-limit-user')).toBe(true);
    // 第四期：命名空间（集群级）、额度与网络策略也观测；额度的状态变化（已用数）照样报来，由调和器决定改不改。
    expect(seen.some((c) => c.kind === 'Namespace' && c.object.metadata.name === 'cs-demo')).toBe(true);
    expect(feed.cached('Namespace', undefined, 'cs-demo')?.metadata.uid).toBe('uid-ns');
    expect(seen.filter((c) => c.kind === 'ResourceQuota').at(-1)?.object.metadata).toMatchObject({ name: 'crewstation-project', resourceVersion: '4' });
    expect(seen.some((c) => c.kind === 'NetworkPolicy' && c.object.metadata.name === 'crewstation-default')).toBe(true);
    expect(seen.some((c) => c.kind === 'Deployment' && c.object.metadata.name === 'demo-green')).toBe(true);
    expect(seen.some((c) => c.kind === 'Job' && c.object.metadata.name === 'build-1')).toBe(true);
    expect(seen.some((c) => c.kind === 'PersistentVolumeClaim' && c.object.metadata.name === 'w' && !c.gone)).toBe(true);
    expect(seen.some((c) => c.kind === 'Service' && c.object.metadata.name === 'task-1')).toBe(true);
    // Secret 的内容不进缓存，也不交给处理者。
    expect(seen.find((c) => c.kind === 'Secret')?.object.metadata.name).toBe('s'); expect(JSON.stringify(seen)).not.toContain('c2VjcmV0');
    expect(feed.cached('Secret', 'cs-demo', 's')).toBeDefined(); expect(JSON.stringify(feed.cached('Secret', 'cs-demo', 's'))).not.toContain('c2VjcmV0');
    expect(seen.filter((c) => c.kind === 'Pod').at(-1)).toMatchObject({ gone: true, object: { metadata: { name: 'a' } } });
  });
});

// RFC-025 I25：工作区容器按名字建，已在就不动；Runner Secret 只在不在时才向所属模块要内容；建时撞上同名的（回执丢了）按已在处理。
describe('工作区容器的建出', () => {
  const pod = { name: 'task-1', namespace: 'cs-demo', taskId: 'rec-1', image: 'task:1', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, workload: 'dev-session', project: 'demo', service: 'demo', pvc: 'task-1-work', secret: 'task-1-runner-1' };

  test('不在才建（内容这时才要），已在返回原实例；预览缺了或不一致才 apply', async () => {
    const k8s = createFakeK8sClient(), writer = kubernetesClusterWriter(k8s);
    let asked = 0;
    const values = async () => { asked += 1; return { CS_RUNNER_TOKEN: 't' }; };
    expect(await writer.ensureRunnerSecret(pod, values)).toEqual({ uid: 'uid-task-1-runner-1', created: true });
    expect(await writer.ensureRunnerSecret(pod, values)).toEqual({ uid: 'uid-task-1-runner-1', created: false });
    expect(asked).toBe(1);
    // 检出用的 Git 凭据（I25）：同样只在不在时才要令牌，建成不可变、键为 token。
    const checkout = { ...pod, checkout: { repoUrl: 'http://git/demo.git', branch: 'main', credentialSecretName: 'task-1-checkout-1', ownedCredential: true } };
    let tokens = 0;
    const token = async () => { tokens += 1; return { token: 'git-t' }; };
    expect((await writer.ensureCheckoutSecret(checkout, token)).created).toBe(true);
    expect((await writer.ensureCheckoutSecret(checkout, token)).created).toBe(false);
    expect(tokens).toBe(1);
    expect(await k8s.get(Resources.Secret!, 'task-1-checkout-1', 'cs-demo')).toMatchObject({ immutable: true, stringData: { token: 'git-t' } });
    expect((await writer.ensurePod(pod)).created).toBe(true);
    expect((await writer.ensurePod(pod)).created).toBe(false);
    expect((await writer.ensureVolume({ name: 'task-1-work', namespace: 'cs-demo', size: '10Gi', labels: {} })).created).toBe(true);
    const preview = { name: 'task-1', namespace: 'cs-demo', taskId: 'rec-1', kind: 'dev-session', targetPort: 3000, route: { host: 'dev.demo.cs.localhost', middlewares: [] } };
    expect(await writer.applyPreview(preview, {})).toBe('applied');
    const service = await k8s.get(Resources.Service!, 'task-1', 'cs-demo'), route = await k8s.get(Resources.IngressRoute!, 'task-1', 'cs-demo');
    expect(await writer.applyPreview(preview, { service: service!, route: route! })).toBe('unchanged');
  });

  test('建时撞上同名的：按已在处理，返回那个实例；其余错误照抛', async () => {
    const k8s = createFakeK8sClient(), writer = kubernetesClusterWriter(k8s);
    const create = k8s.create;
    k8s.create = async (obj) => { await create(obj); return create(obj); };
    expect(await writer.ensurePod(pod)).toEqual({ uid: 'uid-task-1', created: false });
    k8s.create = async () => { throw new Error('API Server 不可用'); };
    await expect(writer.ensureVolume({ name: 'task-2-work', namespace: 'cs-demo', size: '10Gi', labels: {} })).rejects.toThrow('API Server 不可用');
  });
});

// RFC-034: controlled owner replies exercise real DELETE/JSON Patch preconditions; Task's real numeric chain is separate.
describe('RFC-034 generic removal gate on the actual Kubernetes writer', () => {
  test('new marker without the owner, malformed marker and failed reads retain the object; legacy deletion keeps UID-only compatibility', async () => {
    const k8s = createFakeK8sClient();
    const selected = { ...object('Pod', 'guarded', '1'), metadata: { ...object('Pod', 'guarded', '1').metadata, annotations: { [DEVELOPMENT_REMOVAL_ANNOTATION]: '1' } } };
    await k8s.create(selected);
    const target = { kind: 'Pod' as const, namespace: 'cs-demo', name: 'guarded', uid: selected.metadata.uid! };
    expect(await kubernetesClusterWriter(k8s).remove(target)).toMatchObject({ kind: 'waiting' });
    expect(await kubernetesClusterWriter(k8s, undefined, async () => ({ kind: 'unselected' })).remove(target)).toMatchObject({ kind: 'waiting' });
    await k8s.mergePatch(Resources.Pod!, target.name, target.namespace, { metadata: { annotations: { [DEVELOPMENT_REMOVAL_ANNOTATION]: 'bad' } } });
    expect(await kubernetesClusterWriter(k8s, undefined, async () => ({ kind: 'absent' })).remove(target)).toMatchObject({ kind: 'waiting' });
    expect(k8s.deleted).toEqual([]);
    const unreadable = { ...k8s, get: async () => { throw new Error('confidential failure'); } };
    expect(await kubernetesClusterWriter(unreadable).remove(target)).toEqual({ kind: 'waiting', reason: 'development-removal-inspection-unavailable' });
    await k8s.create(object('Pod', 'legacy-gate', '1'));
    await kubernetesClusterWriter(k8s).remove({ ...target, name: 'legacy-gate', uid: 'uid-legacy-gate' });
    expect(await k8s.get(Resources.Pod!, 'legacy-gate', 'cs-demo')).toBeUndefined();
  });
  test('original owner permit uses UID and exact live version, and a same-UID version race waits before retry', async () => {
    const k8s = createFakeK8sClient(); await k8s.create(object('Secret', 'original-runner', '1'));
    const target = { kind: 'Secret' as const, namespace: 'cs-demo', name: 'original-runner', uid: 'uid-original-runner' };
    const read = async () => ({ kind: 'permitted' as const, resourceVersion: (await k8s.get(Resources.Secret!, target.name, target.namespace))!.metadata.resourceVersion! });
    const writer = kubernetesClusterWriter(k8s, undefined, read), remove = k8s.delete;
    let race = true;
    k8s.delete = async (ref, name, namespace, options) => {
      expect(options?.preconditions?.uid).toBe(target.uid); expect(options?.preconditions?.resourceVersion).toBeDefined();
      if (race) { race = false; await k8s.mergePatch(ref, name, namespace, { metadata: { annotations: { update: 'same-uid-new-version' } } }); }
      return remove(ref, name, namespace, options);
    };
    expect(await writer.remove(target)).toEqual({ kind: 'waiting', reason: 'development-removal-version-changed' });
    expect(await k8s.get(Resources.Secret!, target.name, target.namespace)).toBeDefined();
    expect(await writer.remove(target)).toBeUndefined();
    expect(await k8s.get(Resources.Secret!, target.name, target.namespace)).toBeUndefined();
  });
  test('injected writer cannot bypass a pending owner; successful delegation carries the permitted CAS version', async () => {
    const k8s = createFakeK8sClient(); await k8s.create(object('Pod', 'injected-gate', '1'));
    const target = { kind: 'Pod' as const, namespace: 'cs-demo', name: 'injected-gate', uid: 'uid-injected-gate' };
    const delegated: Array<{ resourceVersion?: string }> = [], refusal = { kind: 'waiting' as const, reason: 'downstream-owner-pending' };
    const base = { ...kubernetesClusterWriter(k8s), remove: async (value: typeof target & { resourceVersion?: string }) => { delegated.push(value); return refusal; } };
    expect(await guardedClusterWriter(base, k8s, async () => ({ kind: 'waiting', reason: 'numeric-copy' })).remove(target)).toMatchObject({ kind: 'waiting' });
    expect(delegated).toEqual([]);
    const version = (await k8s.get(Resources.Pod!, target.name, target.namespace))!.metadata.resourceVersion!;
    expect(await guardedClusterWriter(base, k8s, async () => ({ kind: 'permitted', resourceVersion: version })).remove(target)).toBe(refusal);
    expect(delegated).toEqual([{ ...target, resourceVersion: version }]);
    expect(await guardedClusterWriter(base, k8s, async () => ({ kind: 'permitted', resourceVersion: version })).remove({ ...target, resourceVersion: 'stale' })).toMatchObject({ kind: 'waiting' });
    expect(delegated).toHaveLength(1);
  });
  test('physical stop alone leaves the finalizer; same-UID version races retain both our and unrelated finalizers', async () => {
    const k8s = createFakeK8sClient(), id = newResourceId();
    const consumer = { id, resourceId: newResourceId(), taskId: TaskIdSchema.parse(newResourceId()), revision: 1, namespace: 'cs-demo', podName: 'finalizer-gate', volumeUid: crypto.randomUUID(), purpose: 'agent' as const, finalization: null };
    const proof: WorkloadStopProof = { id: newResourceId(), consumer, podUid: 'uid-finalizer-gate', type: 'never-scheduled', nodeName: null, nodeUid: null,
      podResourceVersion: '1', observedAt: '2026-10-01T00:00:00.000Z', containers: [{ kind: 'container', name: 'runner', state: 'never-started', containerId: null, exitCode: null }] };
    await k8s.create({ ...object('Pod', consumer.podName, '1'), metadata: { ...object('Pod', consumer.podName, '1').metadata,
      deletionTimestamp: proof.observedAt, finalizers: [WORKLOAD_STOP_FINALIZER, 'other.example/protect'], annotations: { [WORKLOAD_CONSUMER_ANNOTATION]: id, [DEVELOPMENT_REMOVAL_ANNOTATION]: '1' } }, spec: {} });
    let permitted = false;
    const writer = kubernetesClusterWriter(k8s, undefined, async () => permitted ? { kind: 'permitted', resourceVersion: (await k8s.get(Resources.Pod!, consumer.podName, consumer.namespace))!.metadata.resourceVersion! } : { kind: 'waiting', reason: 'numeric-copy' });
    expect(await writer.releaseWorkloadStop!(proof)).toMatchObject({ kind: 'waiting' });
    expect((await k8s.get(Resources.Pod!, consumer.podName, consumer.namespace))?.metadata.finalizers).toContain(WORKLOAD_STOP_FINALIZER);
    permitted = true; const patch = k8s.jsonPatch; let race = true;
    k8s.jsonPatch = async (...args) => {
      if (race) { race = false; await k8s.mergePatch(Resources.Pod!, consumer.podName, consumer.namespace, { metadata: { annotations: { concurrent: 'write' } } }); }
      return patch(...args);
    };
    expect(await writer.releaseWorkloadStop!(proof)).toEqual({ kind: 'waiting', reason: 'development-removal-version-changed' });
    expect((await k8s.get(Resources.Pod!, consumer.podName, consumer.namespace))?.metadata.finalizers).toEqual([WORKLOAD_STOP_FINALIZER, 'other.example/protect']);
    expect(await writer.releaseWorkloadStop!(proof)).toBeUndefined();
    expect((await k8s.get(Resources.Pod!, consumer.podName, consumer.namespace))?.metadata.finalizers).toEqual(['other.example/protect']);
    const guarded = guardedClusterWriter({ ...writer, releaseWorkloadStop: async () => { throw conflict('selected CAS raced'); } }, k8s, async () => ({ kind: 'permitted', resourceVersion: (await k8s.get(Resources.Pod!, consumer.podName, consumer.namespace))!.metadata.resourceVersion! }));
    expect(await guarded.releaseWorkloadStop!(proof)).toMatchObject({ kind: 'waiting' });
  });
});

function removalLedger(record: LedgerRecordView): LedgerObservations {
  return { get: async () => record, listLive: async () => [record], changesSince: async () => [], latestChange: async () => 0,
    observe: async () => ({ status: 'unchanged' }), observeConditions: async () => ({ status: 'unchanged' }),
    claimOf: async () => record.id, children: async () => [], adoptOrphanVolume: async () => {} };
}
test('actual module composition guards an injected writer rather than only the default factory', async () => {
  const k8s = createFakeK8sClient(); await k8s.create(object('Pod', 'module-injected', '1'));
  const record: LedgerRecordView = { id: newResourceId(), kind: 'agent-execution', desired: 'absent', generation: 1, phase: 'stopping', children: [], conditions: [], spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'module-injected' }] } };
  const ledger = removalLedger(record), calls: string[] = [];
  let seen!: () => void, failWait!: (error: Error) => void; const waited = new Promise<void>((resolve, reject) => { seen = resolve; failWait = reject; });
  const timer = setTimeout(() => failWait(new Error('injected writer never reached the actual removal guard')), 2000);
  const module = createClusterControlModule({ k8s, ledger, systemNamespace: 'cs-system', isAdmin: async () => true, orphanSweep: false,
    legacy: { task: async () => undefined, resolveTaskId: async () => undefined },
    feed: { start: () => {}, stop: async () => {}, synced: async () => {}, list: () => [], cached: () => [...k8s.objects.values()][0] },
    cluster: { ...kubernetesClusterWriter(k8s), remove: async (target) => { calls.push(target.name); } },
    logger: { ...noopLogger, info: (message) => { if (message === 'resource child removal waiting') seen(); } },
    workloads: { inspectDevelopmentRemoval: async () => ({ kind: 'waiting', reason: 'actual-owner-pending' }), runnerValues: async () => ({}), checkoutValues: async () => ({ token: '' }), bindWorkload: async () => {}, workloadUnavailable: async () => {} },
  });
  try { module.observer.start(); await waited; await module.reconciled(); expect(calls).toEqual([]); expect(module.stats().removed).toBe(0); }
  finally { clearTimeout(timer); await module.observer.stop(); }
});

test('Failed, Paused and absent removal callers preserve waiting, retry the same record and count only successful independent objects', async () => {
  for (const state of ['Failed', 'Paused', 'absent']) {
    const kinds = state === 'Failed' ? ['Pod'] : state === 'Paused' ? ['Secret'] : ['Pod', 'Service'];
    const objects = kinds.map((kind) => object(kind, kind.toLowerCase() + '-wait', '1'));
    const record: LedgerRecordView = { id: newResourceId(), kind: state === 'Paused' ? 'business-workspace' : 'agent-execution', desired: state === 'absent' ? 'absent' : 'present',
      generation: 1, phase: 'stopping', children: [], conditions: state === 'absent' ? [] : [{ type: state, status: 'true' }],
      spec: { children: objects.map((entry) => ({ kind: entry.kind, namespace: entry.metadata.namespace, name: entry.metadata.name })), ...(state === 'Failed' ? { workloadConsumerId: newResourceId() } : {}) } };
    const stats = newObservationStats(), retries: string[] = [], messages: string[] = [], k8s = createFakeK8sClient();
    const cluster = { ...kubernetesClusterWriter(k8s), remove: async (target: { kind: string }) => target.kind === 'Service' ? undefined : { kind: 'waiting' as const, reason: 'numeric-copy' } };
    await reconcileRecord({ ledger: removalLedger(record), feed: { start: () => {}, stop: async () => {}, synced: async () => {}, list: () => [], cached: (kind, _ns, name) => objects.find((entry) => entry.kind === kind && entry.metadata.name === name) },
      cluster, stats, clock: { now: () => new Date() }, logger: { ...noopLogger, info: (message) => { messages.push(message); } }, systemNamespace: 'cs-system', retryMs: 17 }, record.id, (id, ms) => { expect(ms).toBe(17); retries.push(id); });
    expect(retries).toContain(record.id); expect(messages).toContain('resource child removal waiting');
    expect(stats.removed).toBe(state === 'absent' ? 1 : 0);
    expect(messages.filter((message) => message === 'resource child removed')).toHaveLength(state === 'absent' ? 1 : 0);
  }
});


// The controlled owner models genuine rechecks; the real Task/PG numeric chain is tested separately.
describe('RFC-034 actual nested factory retains the original owner query and CAS', () => {
  for (const marked of [false, true]) {
    const label = marked ? 'new marker' : 'historical no marker';
    test(`${label}: original pending waits, then actual DELETE progresses and keeps the creator instance`, async () => {
      const k8s = createFakeK8sClient(), target = { kind: 'Secret' as const, namespace: 'cs-demo', name: 'nested-runner', uid: 'uid-nested-runner' };
      await k8s.create({ ...object('Secret', target.name, '1'), metadata: { ...object('Secret', target.name, '1').metadata, annotations: marked ? { [DEVELOPMENT_REMOVAL_ANNOTATION]: '1' } : {} } });
      let permitted = false, reads = 0;
      const base = kubernetesClusterWriter(k8s);
      const writer = guardedClusterWriter(base, k8s, async (query) => {
        reads++; expect(query).toEqual({ ...target, operation: 'delete' });
        return permitted ? { kind: 'permitted', resourceVersion: (await k8s.get(Resources.Secret!, target.name, target.namespace))!.metadata.resourceVersion! } : { kind: 'waiting', reason: 'original-digital-copy-pending' };
      });
      expect(writer.pendingDevelopmentAdmissionReceipts).toBe(base.pendingDevelopmentAdmissionReceipts);
      expect(writer.acknowledgeDevelopmentAdmissionReceipt).toBe(base.acknowledgeDevelopmentAdmissionReceipt);
      expect(await writer.remove(target)).toMatchObject({ kind: 'waiting' }); expect(k8s.deleted).toEqual([]); expect(reads).toBe(1);
      permitted = true; const remove = k8s.delete;
      k8s.delete = async (ref, name, ns, options) => { expect(options?.preconditions?.uid).toBe(target.uid); expect(options?.preconditions?.resourceVersion).toBeDefined(); return remove(ref, name, ns, options); };
      expect(await writer.remove(target)).toBeUndefined(); expect(reads).toBe(3);
      expect(await k8s.get(Resources.Secret!, target.name, target.namespace)).toBeUndefined();
    });
    test(`${label}: changed material after outer permit is rechecked by the real nested factory before DELETE`, async () => {
      const k8s = createFakeK8sClient(), target = { kind: 'Secret' as const, namespace: 'cs-demo', name: 'nested-material', uid: 'uid-nested-material' };
      await k8s.create({ ...object('Secret', target.name, '1'), metadata: { ...object('Secret', target.name, '1').metadata, annotations: marked ? { [DEVELOPMENT_REMOVAL_ANNOTATION]: '1' } : {} }, stringData: { original: 'yes' } });
      let reads = 0, race = true;
      const writer = guardedClusterWriter(kubernetesClusterWriter(k8s), k8s, async () => {
        reads++; const current = (await k8s.get(Resources.Secret!, target.name, target.namespace))!;
        if ((current['stringData'] as { original?: string }).original !== 'yes') return { kind: 'waiting', reason: 'original-material-changed' };
        if (race) { race = false; await k8s.mergePatch(Resources.Secret!, target.name, target.namespace, { stringData: { original: 'changed' } }); }
        return { kind: 'permitted', resourceVersion: current.metadata.resourceVersion! };
      });
      expect(await writer.remove(target)).toEqual({ kind: 'waiting', reason: 'original-material-changed' }); expect(reads).toBe(2); expect(k8s.deleted).toEqual([]);
      await k8s.mergePatch(Resources.Secret!, target.name, target.namespace, { stringData: { original: 'yes' } });
      expect(await writer.remove(target)).toBeUndefined(); expect(reads).toBe(4);
    });
    test(`${label}: same UID race immediately before DELETE waits and next retry repeats both owner reads`, async () => {
      const k8s = createFakeK8sClient(), target = { kind: 'Pod' as const, namespace: 'cs-demo', name: 'nested-cas', uid: 'uid-nested-cas' };
      await k8s.create({ ...object('Pod', target.name, '1'), metadata: { ...object('Pod', target.name, '1').metadata, annotations: marked ? { [DEVELOPMENT_REMOVAL_ANNOTATION]: '1' } : {} } });
      let reads = 0, race = true; const remove = k8s.delete;
      k8s.delete = async (...args) => { if (race) { race = false; await k8s.mergePatch(Resources.Pod!, target.name, target.namespace, { metadata: { annotations: { concurrent: 'changed' } } }); } return remove(...args); };
      const writer = guardedClusterWriter(kubernetesClusterWriter(k8s), k8s, async () => { reads++; return { kind: 'permitted', resourceVersion: (await k8s.get(Resources.Pod!, target.name, target.namespace))!.metadata.resourceVersion! }; });
      expect(await writer.remove(target)).toEqual({ kind: 'waiting', reason: 'development-removal-version-changed' }); expect(reads).toBe(2);
      expect(await k8s.get(Resources.Pod!, target.name, target.namespace)).toBeDefined();
      expect(await writer.remove(target)).toBeUndefined(); expect(reads).toBe(4);
    });
    for (const raceAt of ['inner-read', 'patch'] as const) test(`${label}: finalizer ${raceAt} version race waits without adopting the new version`, async () => {
      const k8s = createFakeK8sClient(), id = newResourceId();
      const consumer = { id, resourceId: newResourceId(), taskId: TaskIdSchema.parse(newResourceId()), revision: 1, namespace: 'cs-demo', podName: 'nested-finalizer', volumeUid: crypto.randomUUID(), purpose: 'agent' as const, finalization: null };
      const proof: WorkloadStopProof = { id: newResourceId(), consumer, podUid: 'uid-nested-finalizer', type: 'never-scheduled', nodeName: null, nodeUid: null, podResourceVersion: '1', observedAt: '2026-10-02T00:00:00.000Z', containers: [{ kind: 'container', name: 'runner', state: 'never-started', containerId: null, exitCode: null }] };
      await k8s.create({ ...object('Pod', consumer.podName, '1'), metadata: { ...object('Pod', consumer.podName, '1').metadata, deletionTimestamp: proof.observedAt, finalizers: [WORKLOAD_STOP_FINALIZER, 'other.example/protect'], annotations: { [WORKLOAD_CONSUMER_ANNOTATION]: id, ...(marked ? { [DEVELOPMENT_REMOVAL_ANNOTATION]: '1' } : {}) } }, spec: {} });
      let reads = 0, race = true, ownerReady = false;
      const change = () => k8s.mergePatch(Resources.Pod!, consumer.podName, consumer.namespace, { metadata: { annotations: { concurrent: 'changed' } } });
      const writer = guardedClusterWriter(kubernetesClusterWriter(k8s), k8s, async (query) => {
        reads++; expect(query.operation).toBe('stop-finalizer');
        if (!ownerReady) return { kind: 'waiting', reason: 'original-digital-copy-pending' };
        const current = (await k8s.get(Resources.Pod!, consumer.podName, consumer.namespace))!;
        if (raceAt === 'inner-read' && race) { race = false; await change(); }
        return { kind: 'permitted', resourceVersion: current.metadata.resourceVersion! };
      });
      expect(await writer.releaseWorkloadStop!(proof)).toEqual({ kind: 'waiting', reason: 'original-digital-copy-pending' });
      expect((await k8s.get(Resources.Pod!, consumer.podName, consumer.namespace))?.metadata.finalizers).toContain(WORKLOAD_STOP_FINALIZER);
      ownerReady = true;
      const patch = k8s.jsonPatch;
      k8s.jsonPatch = async (...args) => { if (raceAt === 'patch' && race) { race = false; await change(); } return patch(...args); };
      expect(await writer.releaseWorkloadStop!(proof)).toEqual({ kind: 'waiting', reason: 'development-removal-version-changed' });
      expect((await k8s.get(Resources.Pod!, consumer.podName, consumer.namespace))?.metadata.finalizers).toEqual([WORKLOAD_STOP_FINALIZER, 'other.example/protect']);
      const before = reads; expect(await writer.releaseWorkloadStop!(proof)).toBeUndefined(); expect(reads).toBe(before + 2);
      expect((await k8s.get(Resources.Pod!, consumer.podName, consumer.namespace))?.metadata.finalizers).toEqual(['other.example/protect']);
    });
  }
  test('an explicit inner owner refusal stays authoritative; an arbitrary version cannot grant marked-object permission', async () => {
    const k8s = createFakeK8sClient(), target = { kind: 'Pod' as const, namespace: 'cs-demo', name: 'nested-explicit', uid: 'uid-nested-explicit' };
    await k8s.create({ ...object('Pod', target.name, '1'), metadata: { ...object('Pod', target.name, '1').metadata, annotations: { [DEVELOPMENT_REMOVAL_ANNOTATION]: '1' } } });
    const version = (await k8s.get(Resources.Pod!, target.name, target.namespace))!.metadata.resourceVersion!;
    const base = kubernetesClusterWriter(k8s, undefined, async () => ({ kind: 'waiting', reason: 'explicit-owner-refusal' }));
    const writer = guardedClusterWriter(base, k8s, async () => ({ kind: 'permitted', resourceVersion: version }));
    expect(await writer.remove(target)).toEqual({ kind: 'waiting', reason: 'explicit-owner-refusal' });
    expect(await kubernetesClusterWriter(k8s).remove({ ...target, resourceVersion: version })).toEqual({ kind: 'waiting', reason: 'development-removal-owner-unavailable' }); expect(k8s.deleted).toEqual([]);
  });
  test('ordinary explicit resourceVersion is retained without creating an owner permission', async () => {
    const k8s = createFakeK8sClient(); await k8s.create(object('Secret', 'legacy-explicit-rv', '1'));
    const target = { kind: 'Secret' as const, namespace: 'cs-demo', name: 'legacy-explicit-rv', uid: 'uid-legacy-explicit-rv' }, writer = kubernetesClusterWriter(k8s);
    const stale = (await k8s.get(Resources.Secret!, target.name, target.namespace))!.metadata.resourceVersion!;
    await k8s.mergePatch(Resources.Secret!, target.name, target.namespace, { metadata: { annotations: { changed: 'yes' } } });
    expect(await writer.remove({ ...target, resourceVersion: stale })).toMatchObject({ kind: 'waiting' }); expect(await k8s.get(Resources.Secret!, target.name, target.namespace)).toBeDefined();
    await writer.remove(target); expect(await k8s.get(Resources.Secret!, target.name, target.namespace)).toBeUndefined();
  });
  test('scope cannot be borrowed by mismatched target/version/operation, concurrent requests or settled async descendants', async () => {
    const k8s = createFakeK8sClient(), base = kubernetesClusterWriter(k8s);
    const target = { kind: 'Pod' as const, namespace: 'cs-demo', name: 'scope-a', uid: 'uid-scope-a' };
    const consumer = { id: newResourceId(), resourceId: newResourceId(), taskId: TaskIdSchema.parse(newResourceId()), revision: 1, namespace: target.namespace, podName: target.name, volumeUid: crypto.randomUUID(), purpose: 'agent' as const, finalization: null };
    const proof: WorkloadStopProof = { id: newResourceId(), consumer, podUid: target.uid, type: 'never-scheduled', nodeName: null, nodeUid: null, podResourceVersion: '1', observedAt: '2026-10-02T00:00:00.000Z', containers: [] };
    for (const name of ['scope-a', 'scope-b']) await k8s.create({ ...object('Pod', name, '1'), metadata: { ...object('Pod', name, '1').metadata, annotations: { [DEVELOPMENT_REMOVAL_ANNOTATION]: '1', [WORKLOAD_CONSUMER_ANNOTATION]: consumer.id }, deletionTimestamp: proof.observedAt, finalizers: [WORKLOAD_STOP_FINALIZER] }, spec: {} });
    await k8s.create({ ...object('Secret', target.name, '1'), metadata: { ...object('Secret', target.name, '1').metadata, annotations: { [DEVELOPMENT_REMOVAL_ANNOTATION]: '1' } } });
    await k8s.create({ ...object('Pod', target.name, '1'), metadata: { ...object('Pod', target.name, '1').metadata, namespace: 'cs-other', annotations: { [DEVELOPMENT_REMOVAL_ANNOTATION]: '1' } } });
    const version = (await k8s.get(Resources.Pod!, target.name, target.namespace))!.metadata.resourceVersion!;
    let reads = 0, after!: () => void, descendant!: Promise<unknown>;
    const gated = guardedClusterWriter({ ...base, remove: async (approved) => {
      const mismatches = [ { ...approved, name: 'scope-b', uid: 'uid-scope-b' }, { ...approved, uid: 'wrong-uid' }, { ...approved, resourceVersion: 'wrong-version' }, { ...approved, namespace: 'cs-other' }, { ...approved, kind: 'Secret' as const } ];
      for (const mismatch of mismatches) expect(await base.remove(mismatch)).toEqual({ kind: 'waiting', reason: 'development-removal-owner-unavailable' });
      expect(await base.releaseWorkloadStop!(proof, version)).toEqual({ kind: 'waiting', reason: 'development-removal-owner-unavailable' });
      const settled = new Promise<void>((resolve) => { after = resolve; }); descendant = settled.then(() => base.remove(approved));
      return { kind: 'waiting', reason: 'downstream-refusal' };
    } }, k8s, async () => { reads++; return { kind: 'permitted', resourceVersion: version }; });
    const concurrent = await Promise.all([gated.remove(target), base.remove({ kind: 'Pod', namespace: 'cs-demo', name: 'scope-b', uid: 'uid-scope-b' })]);
    expect(concurrent).toEqual([{ kind: 'waiting', reason: 'downstream-refusal' }, { kind: 'waiting', reason: 'development-removal-owner-unavailable' }]); expect(reads).toBe(1);
    after(); expect(await descendant).toEqual({ kind: 'waiting', reason: 'development-removal-owner-unavailable' }); expect(reads).toBe(1); expect(k8s.deleted).toEqual([]);
  });
  test('a failed delegate also revokes the exact scope for an already registered async descendant', async () => {
    const k8s = createFakeK8sClient(), base = kubernetesClusterWriter(k8s), target = { kind: 'Secret' as const, namespace: 'cs-demo', name: 'scope-error', uid: 'uid-scope-error' };
    await k8s.create({ ...object('Secret', target.name, '1'), metadata: { ...object('Secret', target.name, '1').metadata, annotations: { [DEVELOPMENT_REMOVAL_ANNOTATION]: '1' } } });
    const version = (await k8s.get(Resources.Secret!, target.name, target.namespace))!.metadata.resourceVersion!;
    let reads = 0, after!: () => void, descendant!: Promise<unknown>;
    const writer = guardedClusterWriter({ ...base, remove: async (approved) => {
      const settled = new Promise<void>((resolve) => { after = resolve; }); descendant = settled.then(() => base.remove(approved)); throw new Error('original delegate failure');
    } }, k8s, async () => { reads++; return { kind: 'permitted', resourceVersion: version }; });
    await expect(writer.remove(target)).rejects.toThrow('original delegate failure'); after();
    expect(await descendant).toEqual({ kind: 'waiting', reason: 'development-removal-owner-unavailable' }); expect(reads).toBe(1); expect(k8s.deleted).toEqual([]);
  });
});
