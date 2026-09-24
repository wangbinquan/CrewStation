import { expect, test } from 'bun:test';
import { noopLogger } from '@crewstation/kernel';
import type { ObservedObject } from '../domain/observation';
import type { ClusterWriter, ManagedObjectFeed } from '../ports/cluster';
import type { LedgerObservations, LedgerRecordView } from '../ports/ledger';
import { newObservationStats } from './observeChange';
import { applyVolume, applyWorkload } from './workloadApply';

const pvc = { kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'task-1-work' };
const pod = { image: 'task:1', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, workload: 'dev-session', project: 'demo', service: 'demo', pvc: 'task-1-work', secret: 'task-1-runner-1' };
const record = (patch: Partial<LedgerRecordView>): LedgerRecordView => ({
  id: 'rec-1', kind: 'dev-workspace', desired: 'present', phase: 'provisioning', children: [], conditions: [{ type: 'Provisioning', status: 'true' }],
  spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'task-1' }, { kind: 'Secret', namespace: 'cs-demo', name: 'task-1-runner-1' }], pod }, ...patch,
});

function harness(cached: readonly string[] = [], objects: Readonly<Record<string, ObservedObject>> = {}) {
  const calls: string[] = [], warns: string[] = [], queued: Array<[string, number | undefined]> = [];
  const feed = { cached: (kind: string, namespace?: string, name?: string) => objects[`${kind}/${namespace}/${name}`] ?? (cached.includes(`${kind}/${namespace}/${name}`) ? ({ kind, metadata: { name: name! } } as ObservedObject) : undefined) } as unknown as ManagedObjectFeed;
  const cluster = {
    ensureVolume: async () => { calls.push('volume'); return { uid: 'u-v', created: true }; },
    ensureRunnerSecret: async () => { calls.push('secret'); return { uid: 'u-s', created: false }; },
    ensureCheckoutSecret: async (_pod: unknown, values: () => Promise<{ token: string }>) => { calls.push(`checkout:${(await values()).token}`); return { uid: 'u-c', created: true }; },
    ensurePod: async () => { calls.push('pod'); return { uid: 'u-p', created: true }; },
    applyPreview: async () => 'unchanged' as const,
  } as unknown as ClusterWriter;
  const ledger = { observeConditions: async (_id: string, conditions: readonly { type: string; status: string }[]) => { calls.push(`condition:${conditions[0]!.type}=${conditions[0]!.status}`); return { status: 'recorded' as const }; } } as unknown as LedgerObservations;
  const deps = { ledger, feed, cluster, stats: newObservationStats(), logger: { ...noopLogger, warn: (msg: string) => { warns.push(msg); } }, retryMs: 10,
    workloads: {
      runnerValues: async () => ({}), checkoutValues: async () => ({ token: 'git-t' }), bindWorkload: async (id: string, uid: string, secretUid?: string) => { calls.push(`bind:${id}:${uid}:${secretUid}`); },
      workloadUnavailable: async (id: string, code: string) => { calls.push(`unavailable:${id}:${code}`); },
    } };
  return { deps, calls, warns, queued, enqueue: (id: string, afterMs?: number) => { queued.push([id, afterMs]); } };
}

// RFC-025 I25：调和器只在所属模块要建出容器时建；建出后把实例交回，建成写进记录。
test('建：卷在了才建 Secret 与 Pod，交回实例、写 Created；卷还没在就过一会儿再核对', async () => {
  const ready = harness(['PersistentVolumeClaim/cs-demo/task-1-work']);
  await applyWorkload(ready.deps, record({}), ready.enqueue);
  expect(ready.calls).toEqual(['secret', 'pod', 'bind:rec-1:u-p:u-s', 'condition:Created=true']);
  expect(ready.deps.stats.applied).toBe(1);
  const waiting = harness();
  await applyWorkload(waiting.deps, record({}), waiting.enqueue);
  expect(waiting.calls).toEqual([]);
  expect(waiting.queued).toEqual([['rec-1', 10]]);
});

test('检出凭据归这一次启动的（I25）：Runner Secret 之后、Pod 之前建，令牌此刻向所属模块要；旧形状（按服务共用的 Secret）不建', async () => {
  const checkout = { repoUrl: 'http://git/demo.git', branch: 'main', credentialSecretName: 'task-1-checkout-1' };
  const owned = harness(['PersistentVolumeClaim/cs-demo/task-1-work']);
  await applyWorkload(owned.deps, record({ spec: { children: record({}).spec.children, pod: { ...pod, checkout: { ...checkout, ownedCredential: true } } } }), owned.enqueue);
  expect(owned.calls).toEqual(['secret', 'checkout:git-t', 'pod', 'bind:rec-1:u-p:u-s', 'condition:Created=true']);
  expect(owned.deps.stats.applied).toBe(2);
  const shared = harness(['PersistentVolumeClaim/cs-demo/task-1-work']);
  await applyWorkload(shared.deps, record({ spec: { children: record({}).spec.children, pod: { ...pod, checkout } } }), shared.enqueue);
  expect(shared.calls).toEqual(['secret', 'pod', 'bind:rec-1:u-p:u-s', 'condition:Created=true']);
});

test('档位测试用临时目录（I25 第四步）：没有卷可等，照样建 Secret 与 Pod', async () => {
  const { pvc: _pvc, ...scratch } = pod;
  const h = harness();
  await applyWorkload(h.deps, record({ kind: 'agent-execution', spec: { children: record({}).spec.children, pod: { ...scratch, emptyDir: true } } }), h.enqueue);
  expect(h.calls).toEqual(['secret', 'pod', 'bind:rec-1:u-p:u-s', 'condition:Created=true']);
  expect(h.queued).toEqual([]);
});

test('不建：所属模块不要（Provisioning 为假或已失败）、没接所属模块、期望不完整（只告警）', async () => {
  const h = harness(['PersistentVolumeClaim/cs-demo/task-1-work']);
  await applyWorkload(h.deps, record({ conditions: [{ type: 'Provisioning', status: 'false' }] }), h.enqueue);
  await applyWorkload(h.deps, record({ conditions: [{ type: 'Provisioning', status: 'true' }, { type: 'Failed', status: 'true' }] }), h.enqueue);
  await applyWorkload({ ...h.deps, workloads: undefined }, record({}), h.enqueue);
  await applyWorkload(h.deps, record({ spec: { children: [] } }), h.enqueue);
  expect(h.calls).toEqual([]);
  expect(h.warns).toEqual(['resource workload spec incomplete']);
});

test('工作卷：要建时不在就建；已在、不要建、观测到过又没了（不补建，只告警）都不动', async () => {
  const spec = { children: [pvc], pvc: { size: '10Gi', labels: {} } };
  const h = harness();
  await applyVolume(h.deps, record({ kind: 'volume', spec }), h.enqueue);
  expect(h.calls).toEqual(['volume']);
  const existing = harness(['PersistentVolumeClaim/cs-demo/task-1-work']);
  await applyVolume(existing.deps, record({ kind: 'volume', spec }), existing.enqueue);
  await applyVolume(existing.deps, record({ kind: 'volume', spec, conditions: [] }), existing.enqueue);
  expect(existing.calls).toEqual([]);
  const lost = harness();
  await applyVolume(lost.deps, record({ kind: 'volume', spec, children: [{ ...pvc, uid: 'old', phase: 'absent', ready: false }] }), lost.enqueue);
  expect(lost.calls).toEqual([]);
  expect(lost.warns).toEqual(['resource volume lost, not recreated']);
});

test('工作卷进了观测缓存：随即唤醒等着它的上级工作区，不等重试间隔；不要建了就不唤醒', async () => {
  const spec = { children: [pvc], pvc: { size: '10Gi', labels: {} } };
  const h = harness(['PersistentVolumeClaim/cs-demo/task-1-work']);
  await applyVolume(h.deps, record({ id: 'vol-1', kind: 'volume', parentId: 'rec-1', spec }), h.enqueue);
  await applyVolume(h.deps, record({ id: 'vol-2', kind: 'volume', spec }), h.enqueue);
  await applyVolume(h.deps, record({ id: 'vol-3', kind: 'volume', parentId: 'rec-3', spec, conditions: [] }), h.enqueue);
  expect(h.queued).toEqual([['rec-1', undefined]]);
});

// I25 第二步：执行环境挂父工作区的卷、钉在它的节点；建之前照观测缓存核对父工作区还是受理时那一个。
const execution = { ...pod, pvc: 'task-p-work', secret: 'cli-1-runner', nodeName: 'node-a', workspace: { pod: 'task-p', podUid: 'u-parent', pvcUid: 'u-pvc' } };
const executionRecord = record({ id: 'exe-1', kind: 'agent-execution', spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'cli-1' }, { kind: 'Secret', namespace: 'cs-demo', name: 'cli-1-runner' }], pod: execution } });
const parentPod = (patch: { uid?: string; node?: string; phase?: string; deleting?: boolean } = {}): ObservedObject => ({
  kind: 'Pod', metadata: { name: 'task-p', namespace: 'cs-demo', uid: patch.uid ?? 'u-parent', ...(patch.deleting ? { deletionTimestamp: '2026-09-24T00:00:00Z' } : {}) },
  spec: { nodeName: patch.node ?? 'node-a' }, status: { phase: patch.phase ?? 'Running' },
});
const parentVolume = (uid = 'u-pvc', phase = 'Bound'): ObservedObject => ({ kind: 'PersistentVolumeClaim', metadata: { name: 'task-p-work', namespace: 'cs-demo', uid }, status: { phase } });
const workspaceObjects = (pod: ObservedObject, volume: ObservedObject) => ({ 'Pod/cs-demo/task-p': pod, 'PersistentVolumeClaim/cs-demo/task-p-work': volume });

test('执行环境：父工作区的 Pod 与卷还是受理时那两个才建，交回 Pod 与 Runner Secret 的实例', async () => {
  const h = harness([], workspaceObjects(parentPod(), parentVolume()));
  await applyWorkload(h.deps, executionRecord, h.enqueue);
  expect(h.calls).toEqual(['secret', 'pod', 'bind:exe-1:u-p:u-s', 'condition:Created=true']);
});

test('执行环境：父工作区的 Pod 或卷没了（工作区重建换了 Pod）、换了实例、换了节点、不在运行、卷没绑定，交所属模块判失败、不建也不等', async () => {
  const gone = [harness(['PersistentVolumeClaim/cs-demo/task-p-work']), harness([], { 'Pod/cs-demo/task-p': parentPod() })];
  const changed = [[parentPod({ uid: 'u-other' }), parentVolume()], [parentPod({ node: 'node-b' }), parentVolume()], [parentPod({ phase: 'Succeeded' }), parentVolume()],
    [parentPod({ deleting: true }), parentVolume()], [parentPod(), parentVolume('u-new')], [parentPod(), parentVolume('u-pvc', 'Lost')]] as const;
  for (const h of [...gone, ...changed.map(([pod, volume]) => harness([], workspaceObjects(pod, volume)))]) {
    await applyWorkload(h.deps, executionRecord, h.enqueue);
    expect(h.calls).toEqual(['unavailable:exe-1:workspace-changed']);
    expect(h.warns).toEqual(['resource workload workspace changed']);
    expect(h.queued).toEqual([]);
  }
});
