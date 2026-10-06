import { expect, test } from 'bun:test';
import type { ProjectDeletionCurrentAssets, ProjectDeletionCurrentPod } from '@crewstation/contracts';
import { LABELS } from '@crewstation/k8s';
import type { Database } from '@crewstation/persistence';
import { jsonHash } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { gatewayContent, gatewayDeletionFixture } from './gatewayDeletionFixture';

const available = await testDatabaseAvailable();
test.skipIf(!available)('gateway explicit decisions preserve full unknown historical Pod/documents; latest, target references and changed consumers block', async () => {
  const f = await gatewayDeletionFixture({ beforeUpgrade: async (db) => {
    await db.execute(sql`INSERT INTO gateway.pod_identities(namespace,pod_name,ip,project,service,workload,physical_slot,version,updated_at) VALUES('cs-old-foreign','old-pod','10.0.0.8','old-foreign','worker','service','blue',1,now())`);
    const document = { version: 0, generatedAt: '2026-10-01T00:00:00.000Z', entries: [{ caller: 'unknown/caller', operations: ['unknown-operation'], platformApi: false, platformHosts: [] }], defaultOpen: [], maxStaleSeconds: 60 };
    await db.execute(sql`INSERT INTO gateway.allowlists(version,document,generated_at) VALUES(0,${JSON.stringify(document)}::jsonb,now())`);
  } });
  let active = false;
  const currentAssets: ProjectDeletionCurrentAssets = { inspect: async () => ({ complete: true, digest: jsonHash({ active }), activeConsumers: active ? ['consumer'] : [], targetReferences: [] }) };
  try {
    const original = await gatewayContent(f.db.db), target = await f.project.api.deletionScope(f.own.id), owner = () => f.application({ currentAssets }).api.deletionOwner!;
    expect((await owner().inspect(target)).complete).toBe(false);
    const items = await owner().repairs!.inspect(target); expect(items.map((item) => item.key).sort()).toEqual(['allowlist:0', 'pod:["cs-old-foreign","old-pod"]']);
    for (const item of items) {
      expect(item.allowedDecisions).toEqual(['retain']); expect(item.confirmed).toBeNull();
      const request = { owner: item.owner, key: item.key, originalDigest: item.originalDigest, evidenceDigest: item.evidenceDigest, decision: 'retain' as const };
      await expect(owner().repairs!.confirm(target, { ...f.admin, isAdmin: false }, request)).rejects.toThrow();
      expect((await owner().repairs!.confirm(target, f.admin, request)).confirmed?.actorId).toBe(f.admin.userId);
      await expect(owner().repairs!.confirm({ ...target, id: f.other.id }, f.admin, request)).rejects.toThrow();
    }
    expect((await owner().inspect(target)).complete).toBe(true); expect(await gatewayContent(f.db.db)).toEqual(original);
    active = true; expect((await owner().inspect(target)).complete).toBe(false); expect((await owner().repairs!.inspect(target)).find((item) => item.key.startsWith('pod:'))!.allowedDecisions).toEqual([]);
    await expect(f.db.db.execute(sql`DELETE FROM gateway.operator_confirmations`).then(() => undefined)).rejects.toThrow();
  } finally { await f.db.drop(); }
});

function liveForeignSource(uid: string) {
  const pod: ProjectDeletionCurrentPod = { namespace: 'cs-gateway-keep', name: 'legacy-active', uid, labels: { [LABELS.project]: 'gateway-keep', [LABELS.service]: 'gateway-keep' }, phase: 'Running', terminating: false,
    containersComplete: true, containers: [{ name: 'worker', id: 'containerd://' + 'a'.repeat(64) }] };
  let pods: readonly ProjectDeletionCurrentPod[] = [pod], references: readonly string[] = [];
  const currentAssets: ProjectDeletionCurrentAssets = { inspect: async () => ({ complete: true, digest: jsonHash({ pods, references }), pods,
    activeConsumers: pods.map((p) => `${p.namespace}/${p.name}@${p.uid}`), targetReferences: references }) };
  return { pod, currentAssets, set: (next: readonly ProjectDeletionCurrentPod[], refs: readonly string[] = []) => { pods = next; references = refs; } };
}
const oldActivePod = (uid: string) => async (db: Database) => {
  await db.execute(sql`INSERT INTO gateway.pod_identities(namespace,pod_name,ip,project,service,workload,physical_slot,version,updated_at,pod_uid) VALUES('cs-gateway-keep','legacy-active','10.0.0.8','gateway-keep','gateway-keep','service','blue',1,now(),${uid})`);
};

test.skipIf(!available)('proven foreign Running Pod requires an explicit immutable current decision, survives all metadata cleanup phases and retains its missing historical birth', async () => {
  const uid = Bun.randomUUIDv7(), witness = liveForeignSource(uid), f = await gatewayDeletionFixture({ beforeUpgrade: oldActivePod(uid), application: { currentAssets: witness.currentAssets } });
  try {
    const owner = f.gateway.api.deletionOwner!, target = await f.project.api.deletionScope(f.own.id);
    const before = await f.db.db.execute(sql`SELECT to_jsonb(r) AS body FROM gateway.pod_identities r WHERE pod_name='legacy-active'`);
    expect((await owner.inspect(target)).complete).toBe(false);
    const [item] = await owner.repairs!.inspect(target); expect(item!.allowedDecisions).toEqual(['retain']); expect(item!.confirmed).toBeNull();
    expect(item!.facts.some((fact) => fact.value.includes(f.other.id))).toBe(true);
    expect(item!.facts.some((fact) => fact.value.includes(witness.pod.containers[0]!.id!))).toBe(true);
    const request = { owner: item!.owner, key: item!.key, originalDigest: item!.originalDigest, evidenceDigest: item!.evidenceDigest, decision: 'retain' as const };
    await owner.repairs!.confirm(target, f.admin, request);
    expect((await f.application({ currentAssets: witness.currentAssets }).api.deletionOwner!.inspect(target)).complete).toBe(true);
    witness.set([{ ...witness.pod, containers: [{ name: 'worker', id: 'containerd://' + 'b'.repeat(64) }] }]);
    expect((await owner.inspect(target)).complete).toBe(false);
    await expect(owner.repairs!.confirm(target, f.admin, request)).rejects.toThrow();
    witness.set([witness.pod]);
    const start = await f.begin(); await f.proceed(start); expect((await f.project.api.completeProjectDeletion(start.lease)).state).toBe('succeeded');
    expect(await f.db.db.execute(sql`SELECT to_jsonb(r) AS body FROM gateway.pod_identities r WHERE pod_name='legacy-active'`)).toEqual(before);
    expect((before[0] as { body: { service_source: unknown } }).body.service_source).toBeNull();
    expect(witness.pod.phase).toBe('Running');
  } finally { await f.db.drop(); }
});

test.skipIf(!available)('active unknown/target/shared/replaced/partial or mismatched public foreign identities never permit retention', async () => {
  const uid = Bun.randomUUIDv7(), witness = liveForeignSource(uid), f = await gatewayDeletionFixture({ beforeUpgrade: oldActivePod(uid) });
  try {
    const target = await f.project.api.deletionScope(f.own.id), inspect = async () => (await f.application({ currentAssets: witness.currentAssets }).api.deletionOwner!.repairs!.inspect(target))[0]!;
    const invalid = [ { ...witness.pod, uid: Bun.randomUUIDv7() }, { ...witness.pod, namespace: 'other-namespace' }, { ...witness.pod, labels: {} },
      { ...witness.pod, labels: { ...witness.pod.labels, [LABELS.service]: 'wrong-service' } }, { ...witness.pod, labels: { ...witness.pod.labels, [LABELS.project]: f.own.slug } },
      { ...witness.pod, labels: { ...witness.pod.labels, hiddenReference: f.own.id } }, { ...witness.pod, terminating: true }, { ...witness.pod, phase: 'Pending' }, { ...witness.pod, containersComplete: false }, { ...witness.pod, containers: [] },
      { ...witness.pod, containers: [{ name: 'worker', id: null }] } ];
    for (const pod of invalid) { witness.set([pod]); expect((await inspect()).allowedDecisions).toEqual([]); }
    witness.set([witness.pod, { ...witness.pod, name: 'shared-runtime' }]); expect((await inspect()).allowedDecisions).toEqual([]);
    witness.set([witness.pod], ['target-reference']); expect((await inspect()).allowedDecisions).toEqual([]);
    witness.set([witness.pod]);
    for (const service of [async () => undefined, async () => ({ ...(await f.originals.service('gateway-keep/gateway-keep'))!, projectId: f.own.id }), async () => ({ ...(await f.originals.service('gateway-keep/gateway-keep'))!, archived: true })]) {
      const owner = f.application({ currentAssets: witness.currentAssets, originals: { ...f.originals, service } }).api.deletionOwner!;
      expect((await owner.repairs!.inspect(target))[0]!.allowedDecisions).toEqual([]);
    }
    expect(await f.db.db.execute(sql`SELECT * FROM gateway.operator_confirmations`)).toHaveLength(0);
  } finally { await f.db.drop(); }
});
