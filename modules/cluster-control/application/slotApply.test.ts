import { expect, test } from 'bun:test';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { ObservedObject } from '../domain/observation';
import type { ClusterWriter, ManagedObjectFeed } from '../ports/cluster';
import type { LedgerObservations, LedgerRecordView } from '../ports/ledger';
import { newObservationStats } from './observeChange';
import { applySlot } from './slotApply';

const children = [{ kind: 'Deployment', namespace: 'cs-demo', name: 'demo-blue' }, { kind: 'Service', namespace: 'cs-demo', name: 'demo-blue' }, { kind: 'Secret', namespace: 'cs-demo', name: 'demo-blue-env-1' }];
const slot = {
  serviceId: 'svc-1', project: 'demo', service: 'demo', physical: 'blue', releaseId: 'rel-1', revision: 1, image: 'img:1', command: ['run'], port: 3000, healthPath: '/healthz',
  replicas: 1, resources: { cpu: '250m', memory: '256Mi' }, envSecret: 'demo-blue-env-1',
};
const record = (patch: Partial<LedgerRecordView> = {}): LedgerRecordView => ({
  id: 'slot-1', kind: 'service-slot', desired: 'present', generation: 1, phase: 'provisioning', children: [], conditions: [{ type: 'Serving', status: 'true' }], spec: { children, slot }, ...patch,
});

function harness(objects: Readonly<Record<string, ObservedObject>> = {}) {
  const calls: string[] = [], warns: string[] = [];
  const feed = { cached: (kind: string, namespace?: string, name?: string) => objects[`${kind}/${namespace}/${name}`] } as unknown as ManagedObjectFeed;
  const cluster = {
    remove: async (target: { kind: string; name: string; uid: string }) => { calls.push(`remove:${target.kind}/${target.name}:${target.uid}`); },
    ensureSlotSecret: async (_slot: unknown, values: () => Promise<Record<string, string>>) => { calls.push(`secret:${Object.keys(await values()).join(',')}`); return { uid: 'u-s', created: true }; },
    applySlotService: async () => { calls.push('service'); return 'unchanged' as const; },
    applySlotDeployment: async (_slot: unknown, generation: number) => { calls.push(`deployment:${generation}`); return 'applied' as const; },
  } as unknown as ClusterWriter;
  const ledger = { observeConditions: async (_id: string, conditions: readonly { type: string; status: string }[]) => { calls.push(`condition:${conditions[0]!.type}=${conditions[0]!.status}`); return { status: 'recorded' as const }; } } as unknown as LedgerObservations;
  const slots = { slotEnvValues: async () => ({ CS_DATABASE_URL: 'x' }), slotFailed: async (ref: { revision: number }, message: string) => { calls.push(`failed:${ref.revision}:${message}`); } };
  const deps = { ledger, feed, cluster, clock: systemClock, stats: newObservationStats(), logger: { ...noopLogger, warn: (msg: string) => { warns.push(msg); } }, slots };
  return { deps, calls, warns };
}

test('旧形状不碰；期望不完整只告警；没接 release、流水线已判失败时不建', async () => {
  const h = harness();
  await applySlot(h.deps, record({ spec: { children: children.slice(0, 2) } }));
  await applySlot(h.deps, record({ spec: { children, slot: { ...slot, port: 0 } } }));
  await applySlot(h.deps, record({ conditions: [{ type: 'Serving', status: 'true' }, { type: 'Failed', status: 'true' }] }));
  await applySlot({ ...h.deps, slots: undefined }, record());
  expect(h.calls).toEqual([]);
  expect(h.warns).toEqual(['resource slot spec incomplete']);
});

test('建：环境 Secret（建时要值）、Service、带期望版本的 Deployment，建成写 Created；建不成写原因、交 release 判失败后抛出', async () => {
  const h = harness();
  await applySlot(h.deps, record({ generation: 4 }));
  expect(h.calls).toEqual(['secret:CS_DATABASE_URL', 'service', 'deployment:4', 'condition:Created=true']);
  expect(h.deps.stats.applied).toBe(2);
  const broken = harness();
  broken.deps.cluster.applySlotDeployment = async () => { throw new Error('admission webhook denied'); };
  expect(await applySlot(broken.deps, record()).then(() => 'ok', (error: Error) => error.message)).toBe('admission webhook denied');
  expect(broken.calls.slice(-2)).toEqual(['condition:Created=false', 'failed:1:admission webhook denied']);
});

test('下线：先按 UID 删 Deployment；它消失之后才删环境 Secret（删除中的不重复删），Service 不动', async () => {
  const deployment = { kind: 'Deployment', metadata: { name: 'demo-blue', namespace: 'cs-demo', uid: 'u-d' } } as ObservedObject;
  const offline = record({ conditions: [{ type: 'Serving', status: 'false' }], children: [{ kind: 'Secret', namespace: 'cs-demo', name: 'demo-blue-env-1', phase: 'Present', ready: true }, { kind: 'Secret', namespace: 'cs-demo', name: 'demo-blue-env-0', phase: 'Present', ready: true }] });
  const first = harness({ 'Deployment/cs-demo/demo-blue': deployment, 'Secret/cs-demo/demo-blue-env-1': { kind: 'Secret', metadata: { name: 'demo-blue-env-1', uid: 'u-s1' } } });
  await applySlot(first.deps, offline);
  expect(first.calls).toEqual(['remove:Deployment/demo-blue:u-d']);
  const second = harness({ 'Secret/cs-demo/demo-blue-env-1': { kind: 'Secret', metadata: { name: 'demo-blue-env-1', uid: 'u-s1' } }, 'Secret/cs-demo/demo-blue-env-0': { kind: 'Secret', metadata: { name: 'demo-blue-env-0', uid: 'u-s0', deletionTimestamp: '2026-09-24T08:00:00Z' } } });
  await applySlot(second.deps, offline);
  expect(second.calls).toEqual(['remove:Secret/demo-blue-env-1:u-s1']);
});
