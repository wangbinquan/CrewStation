import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ClusterLedger, UserId } from '@crewstation/contracts';
import { ClusterPageSchema } from '@crewstation/contracts';
import { createFakeK8sClient } from '@crewstation/k8s';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { clusterManagementMigrations, createClusterManagementModule } from '../index';
import type { ClusterManagementModule } from '../index';
import { claimKey, MAINTAINED_REASON, VOLUME_REASON } from '../domain/ledgerOverlay';
import { admin, catalog, facts, object, query } from './inventoryFixture';

// RFC-025 T13（I29 裁定）：清单以快照为底，台账认领的行叠加所属标准记录；台账维护的对象与工作卷不给直接删，删除前的检查按实时对象再核对一次。
const available = await testDatabaseAvailable();
const projectId = facts.projects[0]!.projectId;
const member: Actor = { userId: '01a0bf5d-8f4b-7a01-8f0e-0d6b1c3f0101' as UserId, isAdmin: false };
const record = (patch: Partial<ClusterLedger>): ClusterLedger => ({ id: '01a0cf2b-22e3-7000-a175-bb5d15367200', kind: 'network-policy-set', phase: 'ready', phaseSince: '2026-09-24T01:00:00.000Z', actions: [], version: 1, maintained: true, ...patch });
const claims = new Map<string, ClusterLedger>([
  [claimKey({ kind: 'NetworkPolicy', namespace: 'cs-demo', name: 'crewstation-default' }), record({})],
  [claimKey({ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'task-work' }), record({ id: '01a0cf2b-22e3-7000-a175-bb5d15367201', kind: 'volume', phase: 'stopped', maintained: false, actions: [{ id: 'delete-volume', enabled: true }] })],
]);
const ledger = { failing: false, actors: [] as Actor[] };
let tdb: TestDatabase, module: ClusterManagementModule;
const k8s = createFakeK8sClient();
beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([queueMigrations, clusterManagementMigrations]);
  module = createClusterManagementModule({
    db: tdb.db, k8s, metadata: { read: async () => structuredClone(facts) }, systemNamespace: 'crewstation-system', catalog, instance: 'test-ledger-overlay', observationMs: 100, wait: async () => undefined,
    domains: { inspect: async () => { throw new Error('unexpected domain'); }, execute: async () => { throw new Error('unexpected domain'); }, observe: async () => { throw new Error('unexpected domain'); } },
    authorizeProject: async (actor) => { if (actor.userId !== member.userId) throw new Error('not a member'); }, isAdmin: async (id) => id === admin.userId,
    ledger: { claims: async (actor, objects) => {
      ledger.actors.push(actor);
      if (ledger.failing) throw new Error('ledger unavailable');
      return objects.flatMap((child) => { const found = claims.get(claimKey(child)); return found ? [{ child, ledger: found }] : []; });
    } },
  });
  await k8s.create({ ...object('NetworkPolicy', 'crewstation-default', 'cs-demo', { podSelector: {} }), apiVersion: 'networking.k8s.io/v1' });
  await k8s.create(object('PersistentVolumeClaim', 'task-work', 'cs-demo'));
  await k8s.create(object('ConfigMap', 'settings', 'cs-demo'));
  await module.collect();
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('ledger overlay on the cluster inventory (RFC-025 T13)', () => {
  test('claimed rows carry their standard record; maintained objects and volumes cannot be deleted directly; unclaimed rows keep the snapshot', async () => {
    const page = ClusterPageSchema.parse(await module.api.resources(admin, query));
    const byName = new Map(page.items.map((item) => [item.name, item]));
    expect(byName.get('crewstation-default')?.ledger).toMatchObject({ kind: 'network-policy-set', maintained: true });
    expect(byName.get('crewstation-default')?.availableActions.find((action) => action.action === 'delete')).toMatchObject({ enabled: false, reason: MAINTAINED_REASON });
    expect(byName.get('task-work')?.ledger).toMatchObject({ kind: 'volume', phase: 'stopped', actions: [{ id: 'delete-volume', enabled: true }] });
    expect(byName.get('task-work')?.availableActions.find((action) => action.action === 'delete')).toMatchObject({ enabled: false, reason: VOLUME_REASON });
    expect(byName.get('settings')?.ledger).toBeUndefined();
    expect(byName.get('settings')?.availableActions.find((action) => action.action === 'delete')?.enabled).toBe(true);
    expect(ledger.actors.at(-1)).toEqual(admin);
  });

  test('detail and the member view overlay too; members see the phase but no record actions', async () => {
    const row = (await module.api.resources(admin, query)).items.find((item) => item.name === 'task-work')!;
    expect((await module.api.detail(admin, row.resourceId)).resource.ledger?.kind).toBe('volume');
    const view = await module.api.projectResources(member, projectId);
    expect(view.items.find((item) => item.name === 'task-work')?.ledger).toMatchObject({ kind: 'volume', phase: 'stopped', actions: [] });
    expect(ledger.actors.at(-1)).toEqual(member);
  });

  test('inspecting a delete re-checks the live object: maintained objects are refused and cannot be accepted', async () => {
    const row = (await module.api.resources(admin, query)).items.find((item) => item.name === 'crewstation-default')!;
    const inspection = await module.api.inspect(admin, row.resourceId, { action: 'delete' });
    expect(inspection.capability).toMatchObject({ enabled: false, reason: MAINTAINED_REASON });
    await expect(module.api.accept(admin, { inspectionId: inspection.inspectionId, idempotencyKey: crypto.randomUUID(), params: { action: 'delete' } })).rejects.toMatchObject({ kind: 'precondition', message: MAINTAINED_REASON });
  });

  test('ledger unavailable: lists fall back to the snapshot, but a delete is not inspected blind', async () => {
    const row = (await module.api.resources(admin, query)).items.find((item) => item.name === 'crewstation-default')!;
    ledger.failing = true;
    try {
      const page = await module.api.resources(admin, query);
      expect(page.items.every((item) => item.ledger === undefined)).toBe(true);
      await expect(module.api.inspect(admin, row.resourceId, { action: 'delete' })).rejects.toMatchObject({ kind: 'precondition' });
    } finally { ledger.failing = false; }
  });
});
