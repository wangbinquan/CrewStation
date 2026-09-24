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

function harness(cached: readonly string[] = []) {
  const calls: string[] = [], warns: string[] = [], queued: Array<[string, number | undefined]> = [];
  const feed = { cached: (kind: string, namespace?: string, name?: string) => (cached.includes(`${kind}/${namespace}/${name}`) ? ({ kind, metadata: { name: name! } } as ObservedObject) : undefined) } as unknown as ManagedObjectFeed;
  const cluster = {
    ensureVolume: async () => { calls.push('volume'); return { uid: 'u-v', created: true }; },
    ensureRunnerSecret: async () => { calls.push('secret'); return { uid: 'u-s', created: false }; },
    ensurePod: async () => { calls.push('pod'); return { uid: 'u-p', created: true }; },
    applyPreview: async () => 'unchanged' as const,
  } as unknown as ClusterWriter;
  const ledger = { observeConditions: async (_id: string, conditions: readonly { type: string; status: string }[]) => { calls.push(`condition:${conditions[0]!.type}=${conditions[0]!.status}`); return { status: 'recorded' as const }; } } as unknown as LedgerObservations;
  const deps = { ledger, feed, cluster, stats: newObservationStats(), logger: { ...noopLogger, warn: (msg: string) => { warns.push(msg); } }, retryMs: 10,
    workloads: { runnerValues: async () => ({}), bindWorkload: async (id: string, uid: string) => { calls.push(`bind:${id}:${uid}`); } } };
  return { deps, calls, warns, queued, enqueue: (id: string, afterMs?: number) => { queued.push([id, afterMs]); } };
}

// RFC-025 I25：调和器只在所属模块要建出容器时建；建出后把实例交回，建成写进记录。
test('建：卷在了才建 Secret 与 Pod，交回实例、写 Created；卷还没在就过一会儿再核对', async () => {
  const ready = harness(['PersistentVolumeClaim/cs-demo/task-1-work']);
  await applyWorkload(ready.deps, record({}), ready.enqueue);
  expect(ready.calls).toEqual(['secret', 'pod', 'bind:rec-1:u-p', 'condition:Created=true']);
  expect(ready.deps.stats.applied).toBe(1);
  const waiting = harness();
  await applyWorkload(waiting.deps, record({}), waiting.enqueue);
  expect(waiting.calls).toEqual([]);
  expect(waiting.queued).toEqual([['rec-1', 10]]);
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
  await applyVolume(h.deps, record({ kind: 'volume', spec }));
  expect(h.calls).toEqual(['volume']);
  const existing = harness(['PersistentVolumeClaim/cs-demo/task-1-work']);
  await applyVolume(existing.deps, record({ kind: 'volume', spec }));
  await applyVolume(existing.deps, record({ kind: 'volume', spec, conditions: [] }));
  expect(existing.calls).toEqual([]);
  const lost = harness();
  await applyVolume(lost.deps, record({ kind: 'volume', spec, children: [{ ...pvc, uid: 'old', phase: 'absent', ready: false }] }));
  expect(lost.calls).toEqual([]);
  expect(lost.warns).toEqual(['resource volume lost, not recreated']);
});
