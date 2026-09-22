import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ClusterResource, UserId } from '@crewstation/contracts';
import { ClusterSummarySchema, IDENTITY_HEADERS, ProjectClusterResourcesSchema } from '@crewstation/contracts';
import { createFakeK8sClient } from '@crewstation/k8s';
import { forbidden, notFound } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { queueMigrations } from '@crewstation/queue';
import { createApp } from '@crewstation/http';
import { clusterManagementMigrations, createClusterManagementModule } from '../index';
import type { ClusterManagementModule } from '../index';
import { projectResourcesIn } from '../application/queries';
import type { InventorySnapshot } from '../domain/inventory';
import { admin, facts, catalog, object, query } from './inventoryFixture';

// RFC-019：项目成员经 develop 动作读本项目的受管资源；测试员、非成员与不存在的项目在授权处被拒，管理动作一律清空。
const available = await testDatabaseAvailable();
const projectId = facts.projects[0]!.projectId;
const member: Actor = { userId: '01a0bf5d-8f4b-7a01-8f0e-0d6b1c3f0001' as UserId, isAdmin: false };
const tester: Actor = { userId: '01a0bf5d-8f4b-7a01-8f0e-0d6b1c3f0002' as UserId, isAdmin: false };
let tdb: TestDatabase, module: ClusterManagementModule;
const k8s = createFakeK8sClient();
const authorizeProject = async (actor: Actor, id: string): Promise<void> => {
  if (id !== projectId) throw notFound('项目', id);
  if (actor.isAdmin || actor.userId === member.userId) return;
  throw forbidden('需要项目开发权限');
};
beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([queueMigrations, clusterManagementMigrations]);
  module = createClusterManagementModule({ db: tdb.db, k8s, metadata: { read: async () => structuredClone(facts) }, domains: { inspect: async () => { throw new Error('unexpected domain'); }, execute: async () => { throw new Error('unexpected domain'); }, observe: async () => { throw new Error('unexpected domain'); } }, authorizeProject, isAdmin: async (id) => id === admin.userId, systemNamespace: 'crewstation-system', catalog, instance: 'test-project-resources', observationMs: 100, wait: async () => undefined });
  await k8s.create({ ...object('Deployment', 'demo-green', 'cs-demo', { replicas: 1 }), status: { replicas: 1, readyReplicas: 1, availableReplicas: 1 } });
  await k8s.create({ ...object('Pod', 'demo-green-1', 'cs-demo', { containers: [{ name: 'app', image: 'registry.cs.internal/demo:v0.1.4' }] }), status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: 'app', ready: true, restartCount: 0, state: { running: {} } }] } });
  await k8s.create({ ...object('Pod', 'subtask-1', 'cs-demo', { containers: [{ name: 'app', image: 'registry.cs.internal/task:1' }] }), status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable', message: '0/1 nodes are available: Insufficient cpu' }] } });
  await k8s.create(object('PersistentVolumeClaim', 'task-work', 'cs-demo'));
  await k8s.create(object('ConfigMap', 'settings', 'cs-demo'));
  await k8s.create(object('Pod', 'coredns', 'kube-system'));
  await module.collect();
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('project-scoped read-only inventory (RFC-019)', () => {
  test('a developer reads only this project, Pods first, without any management action', async () => {
    const page = ProjectClusterResourcesSchema.parse(await module.api.projectResources(member, projectId));
    expect(page.items.length).toBeGreaterThanOrEqual(5);
    expect(page.items.every((item) => item.ownership.scope === 'project' && item.ownership.projectId === projectId)).toBe(true);
    expect(page.items.some((item) => item.namespace === 'kube-system')).toBe(false);
    expect(page.items.slice(0, 2).map((item) => item.kind)).toEqual(['Pod', 'Pod']);
    expect(page.items.every((item) => item.availableActions.length === 0)).toBe(true);
    expect(page.items.find((item) => item.name === 'subtask-1')).toMatchObject({ phase: 'Pending', ready: false });
    expect(Number.isNaN(Date.parse(page.observedAt))).toBe(false);
    expect(page.truncated).toBe(false);
    const summary = ClusterSummarySchema.parse(await module.api.summary(admin, query));
    expect(page.snapshotId).toBe(summary.snapshotId);
    // 管理员走同一条用例也拿不到动作；同一快照的管理员列表则仍带动作能力。
    expect((await module.api.projectResources(admin, projectId)).items.every((item) => item.availableActions.length === 0)).toBe(true);
    expect((await module.api.resources(admin, { ...query, kind: 'ConfigMap' })).items[0]?.availableActions.length).toBeGreaterThan(0);
  });
  test('summary carries per-project counts that equal the filtered inventory', async () => {
    const summary = ClusterSummarySchema.parse(await module.api.summary(admin, query));
    const counts = summary.projects.find((p) => p.id === projectId)!;
    const rows = (await module.api.resources(admin, { ...query, scope: 'project', projectId, limit: 100 })).items;
    const count = (fn: (r: ClusterResource) => boolean) => rows.filter(fn).length;
    expect(counts).toMatchObject({ name: 'Demo', workloads: count((r) => r.view === 'workloads' && r.topLevel), pods: count((r) => r.kind === 'Pod'), readyPods: count((r) => r.kind === 'Pod' && r.ready), abnormal: count((r) => r.kind === 'Pod' && r.abnormal), devSessions: 0 });
    expect(counts.pods).toBe(2); expect(counts.readyPods).toBe(1);
  });
  test('tester, stranger and unknown project are refused at authorization; expired snapshot is 410', async () => {
    await expect(module.api.projectResources(tester, projectId)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(module.api.projectResources({ userId: '01a0bf5d-8f4b-7a01-8f0e-0d6b1c3f0009' as UserId, isAdmin: false }, projectId)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(module.api.projectResources(member, '01a0bf5d-8f4b-7a01-8f0e-0d6b1c3f0010')).rejects.toMatchObject({ kind: 'not_found' });
    await expect(module.api.projectResources(member, projectId, 'snapshot-that-never-existed')).rejects.toMatchObject({ kind: 'not_found', details: { status: 410 } });
  });
  test('HTTP: 401 without identity, 400 on a malformed project id, 403 for a tester, 200 for a developer', async () => {
    const app = createApp({ name: 'cluster-project-test' }); for (const r of module.http) app.route('/', r);
    const as = (actor: Actor) => ({ [IDENTITY_HEADERS.userId]: actor.userId, [IDENTITY_HEADERS.userName]: 'n', [IDENTITY_HEADERS.userEmail]: 'e@x' });
    expect((await app.request(`/v1/projects/${projectId}/cluster-resources`)).status).toBe(401);
    expect((await app.request('/v1/projects/not-a-uuid/cluster-resources', { headers: as(member) })).status).toBe(400);
    expect((await app.request(`/v1/projects/${projectId}/cluster-resources`, { headers: as(tester) })).status).toBe(403);
    const ok = await app.request(`/v1/projects/${projectId}/cluster-resources`, { headers: as(member) });
    expect(ok.status).toBe(200);
    expect(ProjectClusterResourcesSchema.parse(await ok.json()).items.every((item) => item.availableActions.length === 0)).toBe(true);
    expect((await app.request(`/v1/projects/${projectId}/cluster-resources?snapshotId=${'x'.repeat(201)}`, { headers: as(member) })).status).toBe(400);
  });
  test('more than 500 resources are truncated with Pods and workloads kept first', async () => {
    const template = (await module.api.projectResources(member, projectId)).items[0]!;
    const make = (index: number, kind: string, view: ClusterResource['view']): ClusterResource => ({ ...template, resourceId: `r-${index}`, uid: `uid-${index}`, name: `${kind.toLowerCase()}-${index}`, kind, view, topLevel: view === 'workloads', availableActions: [{ action: 'restart', enabled: true, reason: '', executionRoute: 'kubernetes', impactSummary: [] }] });
    const resources = [...Array.from({ length: 300 }, (_, i) => make(i, 'ConfigMap', 'storage')), ...Array.from({ length: 150 }, (_, i) => make(300 + i, 'Pod', 'pods')), ...Array.from({ length: 60 }, (_, i) => make(450 + i, 'Deployment', 'workloads'))];
    const snapshot: InventorySnapshot = { id: 'synthetic', startedAt: '2026-09-22T00:00:00.000Z', finishedAt: '2026-09-22T00:00:30.000Z', sources: [], resources, facts: structuredClone(facts) };
    const page = projectResourcesIn(snapshot, projectId);
    expect(page.truncated).toBe(true); expect(page.items).toHaveLength(500);
    expect(page.items.filter((item) => item.kind === 'Pod')).toHaveLength(150); expect(page.items.filter((item) => item.kind === 'Deployment')).toHaveLength(60);
    expect(page.items.every((item) => item.availableActions.length === 0)).toBe(true);
    expect(page.complete).toBe(true); expect(page.observedAt).toBe('2026-09-22T00:00:30.000Z');
  });
});
