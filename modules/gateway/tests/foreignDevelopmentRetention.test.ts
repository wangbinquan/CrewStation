import { expect, test } from 'bun:test';
import { TaskIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionCurrentAssets, ProjectDeletionCurrentPod } from '@crewstation/contracts';
import { LABELS } from '@crewstation/k8s';
import { jsonHash } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { GatewayCurrentDevelopment } from '../ports/repositories';
import { fixturePermit, gatewayDeletionFixture } from './gatewayDeletionFixture';
import type { GatewayDeletionFixture } from './gatewayDeletionFixture';

const available = await testDatabaseAvailable();
const oldDevelopment = (taskId: string) => async (db: Database) => {
  await db.execute(sql`INSERT INTO gateway.pod_identities(namespace,pod_name,ip,project,service,workload,task_id,version,updated_at)
    VALUES('cs-gateway-keep','old-development','10.0.0.8','gateway-keep','gateway-keep','dev-session',${taskId},1,now())`);
};
function witness(f: GatewayDeletionFixture, taskId: string) {
  const pod: ProjectDeletionCurrentPod = { namespace: f.other.namespace, name: 'current-rebuilt', uid: Bun.randomUUIDv7(), labels: {
    [LABELS.task]: taskId, [LABELS.project]: f.other.slug, [LABELS.service]: f.other.slug, [LABELS.workload]: 'dev-session', 'app.kubernetes.io/managed-by': 'crewstation',
  }, phase: 'Running', terminating: false, containersComplete: true, containers: [{ name: 'worker', id: 'containerd://' + 'a'.repeat(64) }] };
  const assets = { complete: true as const, digest: jsonHash(pod), pods: [pod], activeConsumers: [`${pod.namespace}/${pod.name}@${pod.uid}`], targetReferences: [] as string[] };
  const base: GatewayCurrentDevelopment = { taskId, projectId: f.other.id, serviceId: f.other.serviceId!, namespace: f.other.namespace, podName: pod.name, podUid: pod.uid,
    kind: 'dev-session', state: 'running', originalAbsent: true, taskDigest: jsonHash('public-task-binding'),
    volumes: [{ namespace: f.other.namespace, name: 'current-pvc', uid: 'current-pvc-uid', pvName: 'current-pv', pvUid: 'current-pv-uid', digest: jsonHash('complete-pvc-pv-binding') }], assets };
  const state = { source: structuredClone(base) as GatewayCurrentDevelopment | undefined };
  const currentAssets: ProjectDeletionCurrentAssets = { inspect: async () => structuredClone(assets) };
  const owner = () => f.application({ currentAssets, originals: { ...f.originals, currentDevelopment: async () => state.source } }).api.deletionOwner!;
  return { base, state, pod, currentAssets, owner };
}

test.skipIf(!available)('explicit foreign development current baseline survives restart and all cleanup phases while retaining the full missing-birth record and current resources', async () => {
  const taskId = TaskIdSchema.parse(Bun.randomUUIDv7()), f = await gatewayDeletionFixture({ beforeUpgrade: oldDevelopment(taskId) });
  try {
    const w = witness(f, taskId), target = await f.project.api.deletionScope(f.own.id), owner = w.owner();
    const before = await f.db.db.execute(sql`SELECT to_jsonb(r) AS body FROM gateway.pod_identities r WHERE pod_name='old-development'`);
    const [item] = await owner.repairs!.inspect(target); expect(item!.allowedDecisions).toEqual(['retain']); expect(item!.confirmed).toBeNull(); expect((await owner.inspect(target)).complete).toBe(false);
    expect(item!.facts.some(fact => fact.value.includes('旧 UID 未记录'))).toBe(true); expect(item!.facts.some(fact => fact.value.includes('current-pv-uid'))).toBe(true);
    const request = { owner: item!.owner, key: item!.key, originalDigest: item!.originalDigest, evidenceDigest: item!.evidenceDigest, decision: 'retain' as const };
    await expect(owner.repairs!.confirm(target, { ...f.admin, isAdmin: false }, request)).rejects.toThrow();
    await owner.repairs!.confirm(target, f.admin, request); expect((await w.owner().inspect(target)).complete).toBe(true);
    const permit = fixturePermit(f.project.api, w.owner(), f.admin, f.own.id);
    const plan = await permit.begin(); await permit.proceed(plan); expect((await f.project.api.completeProjectDeletion(plan.lease)).state).toBe('succeeded');
    expect(await f.db.db.execute(sql`SELECT to_jsonb(r) AS body FROM gateway.pod_identities r WHERE pod_name='old-development'`)).toEqual(before);
    expect((before[0] as { body: { pod_uid: unknown; development_source: unknown } }).body).toMatchObject({ pod_uid: null, development_source: null });
    expect(w.pod.phase).toBe('Running');
  } finally { await f.db.drop(); }
});

test.skipIf(!available)('unknown/target/shared/mismatched or changed task/Pod/container/volume facts invalidate foreign development retention', async () => {
  const taskId = TaskIdSchema.parse(Bun.randomUUIDv7()), f = await gatewayDeletionFixture({ beforeUpgrade: oldDevelopment(taskId) });
  try {
    const w = witness(f, taskId), target = await f.project.api.deletionScope(f.own.id), owner = w.owner();
    w.state.source = undefined;
    const [unchanged] = await owner.repairs!.inspect(target), known = await f.originals.service('gateway-keep/gateway-keep');
    expect(unchanged!.evidenceDigest).toBe(jsonHash({ target: target.id, evidence: { current: w.base.assets, known } }));
    const invalid: GatewayCurrentDevelopment[] = [
      { ...w.base, taskId: Bun.randomUUIDv7() }, { ...w.base, projectId: f.own.id }, { ...w.base, serviceId: f.own.serviceId! }, { ...w.base, namespace: f.own.namespace },
      { ...w.base, podName: 'old-development' }, { ...w.base, podUid: 'replacement' }, { ...w.base, volumes: [] }, { ...w.base, taskDigest: 'partial' },
      { ...w.base, assets: { ...w.base.assets, targetReferences: ['shared-target'] } },
      ...[{ ...w.pod, containersComplete: false }, { ...w.pod, phase: 'Pending' }, { ...w.pod, terminating: true }, { ...w.pod, containers: [] }, { ...w.pod, containers: [{ name: 'worker', id: null }] },
        { ...w.pod, labels: { ...w.pod.labels, [LABELS.task]: Bun.randomUUIDv7() } }, { ...w.pod, labels: { ...w.pod.labels, [LABELS.service]: 'wrong-service' } },
        { ...w.pod, labels: { ...w.pod.labels, hiddenReference: f.own.id } }].map(pod => ({ ...w.base, assets: { ...w.base.assets, pods: [pod] } })),
    ];
    for (const source of [undefined, ...invalid]) { w.state.source = source; expect((await owner.repairs!.inspect(target))[0]!.allowedDecisions).toEqual([]); }
    w.state.source = w.base; const [item] = await owner.repairs!.inspect(target), request = { owner: item!.owner, key: item!.key, originalDigest: item!.originalDigest, evidenceDigest: item!.evidenceDigest, decision: 'retain' as const };
    await owner.repairs!.confirm(target, f.admin, request);
    for (const source of [{ ...w.base, taskDigest: jsonHash('changed-public-task') }, { ...w.base, volumes: [{ ...w.base.volumes[0]!, uid: 'replacement-pvc', digest: jsonHash('changed-claim') }] },
      { ...w.base, assets: { ...w.base.assets, digest: jsonHash('changed-container'), pods: [{ ...w.pod, containers: [{ name: 'worker', id: 'containerd://' + 'b'.repeat(64) }] }] } }]) {
      w.state.source = source; expect((await owner.inspect(target)).complete).toBe(false); await expect(owner.repairs!.confirm(target, f.admin, request)).rejects.toThrow();
    }
  } finally { await f.db.drop(); }
});

test.skipIf(!available)('a current volume changing while saving rolls back the whole immutable confirmation instead of granting a stale foreign exclusion', async () => {
  const taskId = TaskIdSchema.parse(Bun.randomUUIDv7()), f = await gatewayDeletionFixture({ beforeUpgrade: oldDevelopment(taskId) });
  try {
    const w = witness(f, taskId), target = await f.project.api.deletionScope(f.own.id), [item] = await w.owner().repairs!.inspect(target);
    const request = { owner: item!.owner, key: item!.key, originalDigest: item!.originalDigest, evidenceDigest: item!.evidenceDigest, decision: 'retain' as const }; let calls = 0;
    const owner = f.application({ currentAssets: w.currentAssets, originals: { ...f.originals, currentDevelopment: async () => ++calls === 1 ? w.base : { ...w.base, volumes: [{ ...w.base.volumes[0]!, pvUid: 'replaced-pv', digest: jsonHash('changed-volume') }] } } }).api.deletionOwner!;
    await expect(owner.repairs!.confirm(target, f.admin, request)).rejects.toThrow('保存期间变化'); expect(await f.db.db.execute(sql`SELECT * FROM gateway.operator_confirmations`)).toHaveLength(0);
  } finally { await f.db.drop(); }
});
