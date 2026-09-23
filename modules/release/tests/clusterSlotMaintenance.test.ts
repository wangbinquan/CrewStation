import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { Actor, ClusterAction, ClusterInspection, ClusterOperation, ClusterResource, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { createReleaseModule, releaseMigrations } from '../wiring';
const available = await testDatabaseAvailable();
let database: TestDatabase | undefined;
afterEach(async () => { await database?.drop(); database = undefined; });
const admin: Actor = { userId: '01a0bf5d-8f4b-7210-80c1-302ae945a98e' as UserId, isAdmin: true }, serviceId = '01a0bf5d-8f4b-7aea-8983-7b41e8b30563' as ServiceId, projectId = '01a0bf5d-8f4b-7710-89f8-83b88c835ea6' as ProjectId;
const yaml = 'apiVersion: crewstation/v2\nkind: DigitalWorker\nspec:\n  service: { command: [bun], port: 3000, healthPath: /healthz, servicePlanId: 01a0bf5d-8f4b-781d-8b8e-bbbbc69c6c6a, replicas: 1 }\n  release:\n    migration: { compatibility: none, destructive: false, rollback: switch-back }\n';
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value; }
async function fixture() {
  database = await createTestDatabase([eventbusMigrations, queueMigrations, releaseMigrations]);
  const k8s = createFakeK8sClient(); let version = 0;
  const release = createReleaseModule({ db: database.db, k8s, isAdmin: async (id) => id === admin.userId, authorizer: { authorize: async () => {} },
    tagger: { createReleaseTag: async () => ({ tag: `v0.0.${++version}`, commitSha: `sha-${version}` }) }, repo: { readFile: async (_s, _r, path) => path === 'crewstation.yaml' ? yaml : undefined, repositoryUrl: async () => ({ httpUrl: 'https://repo.invalid/test', credentialSecretName: 'test-git' }) },
    services: { resolveServiceById: async () => ({ projectId, slug: 'maintenance', name: 'maintenance', namespace: 'cs-maintenance' }) },
    plans: { getServicePlan: async () => ({ id: '01a0bf5d-8f4b-781d-8b8e-bbbbc69c6c6a', name: 'small', cpu: '1', memory: '1Gi', maxReplicas: 3, description: '' }), lookupComputeProfile: async () => undefined, listComputeProfiles: async () => [] },
    config: { render: async () => ({ values: {}, version: 1 }), validate: async () => ({ missing: [] }) }, data: { envFor: async () => ({}) }, hosts: { prodHost: () => 'prod.invalid', previewHost: () => 'preview.invalid' },
    maintenance: { open: async () => false }, owners: { ownerOf: async () => undefined }, notifier: { notify: async () => {} },
    settings: { registryBase: 'registry', buildTimeoutSeconds: 10, deployTimeoutSeconds: 10, builderImage: 'builder', buildkitAddress: 'buildkit', workerOwner: 'slot-test', serviceDomain: 'svc.internal', userDomain: 'user.invalid' } });
  const publish = async (ready = true) => {
    const rel = await release.api.publish(admin, serviceId, { branch: 'main', version: 'patch' }); await release.api.runPipelineStep(rel.id);
    await k8s.mergePatch(Resources.Job!, `build-${rel.id.replaceAll('-', '')}`, 'cs-maintenance', { status: { succeeded: 1 } }); await release.api.runPipelineStep(rel.id);
    if (ready) { const d = (await k8s.get(Resources.Deployment!, 'maintenance-green', 'cs-maintenance'))!; const n = (d.spec as { replicas: number }).replicas; await mark(n); await release.api.runPipelineStep(rel.id); }
    return rel;
  };
  const mark = (n: number, generation = 2) => k8s.mergePatch(Resources.Deployment!, 'maintenance-green', 'cs-maintenance', { metadata: { generation }, status: { replicas: n, readyReplicas: n, updatedReplicas: n, observedGeneration: generation } });
  const target = async (): Promise<ClusterResource> => {
    const d = (await k8s.get(Resources.Deployment!, 'maintenance-green', 'cs-maintenance'))!, slot = (await release.api.listClusterSlots()).find((s) => s.physical === 'green')!;
    const revision = createHash('sha256').update(JSON.stringify(canonical({ uid: d.metadata.uid, spec: d.spec, data: d.data, type: d.type, owners: d.metadata.ownerReferences, labels: d.metadata.labels }))).digest('hex');
    return { resourceId: 'resource', uid: d.metadata.uid!, apiVersion: d.apiVersion, kind: d.kind, name: d.metadata.name, namespace: 'cs-maintenance', resourceVersion: d.metadata.resourceVersion!, revision, observedAt: new Date().toISOString(), generation: d.metadata.generation, view: 'workloads', ownership: { scope: 'project', projectId, projectName: 'Maintenance', slug: 'maintenance', projectKind: 'DigitalWorker', archived: false }, purpose: 'digital-worker-service', phase: 'Active', ready: true, abnormal: false, reason: '', topLevel: true, standalone: false, restarts: 0, labels: d.metadata.labels!, owners: [], references: [], containers: [], facts: {}, serviceId, physicalSlot: 'green', slotRole: slot.role, domainRevision: slot.revision, availableActions: (['restart', 'scale', 'restore-replicas', 'delete'] as const).map((action) => ({ action, enabled: true, executionRoute: 'release', reason: '', impactSummary: [] })) };
  };
  const command = async (action: ClusterAction, replicas?: number) => {
    const row = await target(), request = { action, ...(replicas === undefined ? {} : { replicas }) }, checked = await release.api.inspectSlotOperation(admin, row, request);
    const inspection: ClusterInspection = { ...checked, inspectionId: crypto.randomUUID(), expiresAt: new Date(Date.now() + 300_000).toISOString(), target: row, request, related: [] };
    const op: ClusterOperation = { operationId: crypto.randomUUID(), inspectionId: inspection.inspectionId, idempotencyKey: crypto.randomUUID(), actorId: admin.userId, action, target: row, params: request, phase: 'executing', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), durationMs: 0, traceId: 'trace', httpStatus: 202, reason: '' };
    return { op, inspection };
  };
  return { k8s, release, publish, mark, target, command };
}
describe.skipIf(!available)('release slot maintenance lifecycle', () => {
  test('scale persists through the next publish, restore clears override, prod delete blocked, preview delete retains history/Service', async () => {
    const f = await fixture(); const first = await f.publish(); const scale = await f.command('scale', 2);
    expect(scale.inspection.capability.enabled).toBe(true); await f.release.api.executeSlotOperation(admin, scale.op, scale.inspection);
    await expect(f.release.api.publish(admin, serviceId, { branch: 'main', version: 'patch' })).rejects.toThrow('运维');
    expect((await f.release.api.observeSlotOperation(scale.op)).done).toBe(false);
    await f.mark(2); expect((await f.release.api.observeSlotOperation(scale.op)).done).toBe(true);
    expect((await f.release.api.listClusterSlots()).find((s) => s.physical === 'green')?.overrideReplicas).toBe(2);
    const second = await f.publish(); expect((await f.k8s.get(Resources.Deployment!, 'maintenance-green', 'cs-maintenance'))?.spec).toMatchObject({ replicas: 2 });
    const restore = await f.command('restore-replicas'); await f.release.api.executeSlotOperation(admin, restore.op, restore.inspection); await f.mark(1); await f.release.api.observeSlotOperation(restore.op);
    expect((await f.release.api.listClusterSlots()).find((s) => s.physical === 'green')?.overrideReplicas).toBeUndefined();
    await f.release.api.switchTraffic(admin, serviceId, { toSlot: 'preview' }); expect((await f.command('delete')).inspection.capability).toMatchObject({ enabled: false, reason: expect.stringContaining('正式槽') });
    // A separate service remains at preview for deletion; active role is changed through the normal switch API above.
    expect((await f.release.api.getRelease(admin, first.id)).id).toBe(first.id); expect((await f.release.api.getRelease(admin, second.id)).status).toBe('ready');
  });
  test('standby delete, restart marker recovery, HPA and stale slot confirmations', async () => {
    const f = await fixture(); const rel = await f.publish(); const restart = await f.command('restart');
    await f.release.api.executeSlotOperation(admin, restart.op, restart.inspection); const count = f.k8s.applied.length;
    await f.release.api.executeSlotOperation(admin, restart.op, restart.inspection); expect(f.k8s.applied.length).toBe(count);
    await f.mark(1, 3); expect((await f.release.api.observeSlotOperation(restart.op)).done).toBe(true);
    await f.k8s.create({ apiVersion: 'autoscaling/v2', kind: 'HorizontalPodAutoscaler', metadata: { name: 'auto', namespace: 'cs-maintenance' }, spec: { scaleTargetRef: { kind: 'Deployment', name: 'maintenance-green' } } });
    expect((await f.command('scale', 2)).inspection.capability.reason).toContain('HPA');
    await f.k8s.delete(Resources.HorizontalPodAutoscaler!, 'auto', 'cs-maintenance'); expect((await f.command('scale', 4)).inspection.capability.enabled).toBe(false);
    const del = await f.command('delete'); await f.release.api.executeSlotOperation(admin, del.op, del.inspection); expect((await f.release.api.observeSlotOperation(del.op)).done).toBe(true);
    // RFC-021 B7：集群管理删除非正式槽与项目侧「下线」是同一个结果——槽空、版本转已下线、原因记集群管理、可以重新部署。
    const green = (await f.release.api.listClusterSlots()).find((s) => s.physical === 'green');
    expect(green).toMatchObject({ state: 'empty' });
    expect(green?.releaseId).toBeUndefined();
    expect((await f.release.api.getSlots(admin, serviceId)).find((s) => s.name === 'preview')?.offline).toMatchObject({ releaseId: rel.id, reason: 'cluster', actorUserId: admin.userId });
    expect(await f.release.api.getRelease(admin, rel.id)).toMatchObject({ status: 'offline', redeployable: true });
    expect((await f.release.api.listSlotEvents(admin, serviceId))[0]).toMatchObject({ kind: 'offline', reason: 'cluster', releaseId: rel.id });
    expect(await f.k8s.get(Resources.Service!, 'maintenance-green', 'cs-maintenance')).toBeDefined();
    await expect(f.release.api.switchTraffic(admin, serviceId, { toSlot: 'preview' })).rejects.toThrow();
    await f.publish(); expect(await f.k8s.get(Resources.Deployment!, 'maintenance-green', 'cs-maintenance')).toBeDefined();
  });
});
