import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ClusterAction, ClusterInspection, ClusterOperation, ClusterResource, ProjectId, ReleaseId, ServiceId, UserId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import type { FakeK8sClient, K8sObject } from '@crewstation/k8s';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { queueMigrations } from '@crewstation/queue';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { ReleaseModule } from '../wiring';
import { createReleaseModule, releaseMigrations } from '../wiring';

// RFC-025 T8：服务槽由资源中心建出——部署只把期望随槽状态写进台账（没有配置与密钥），调和器建对象、建环境 Secret 时回头向 release 要环境；
// 流水线照槽记录判铺开（观测到的 Deployment 得是渲染最新期望的那个）；建不成由调和器报来、流水线判失败；集群管理的扩缩、重启、删除改为写期望。
// 这里用真实的台账，调和器由用例模拟：照记录要环境、把 Deployment 落到假集群、写一条观测。
const available = await testDatabaseAvailable();
const admin: Actor = { userId: '01a0bf5d-8f4b-7210-80c1-302ae945a9c1' as UserId, isAdmin: true };
const serviceId = '01a0bf5d-8f4b-7aea-8983-7b41e8b305c1' as ServiceId, projectId = '01a0bf5d-8f4b-7710-89f8-83b88c835ec1' as ProjectId;
const plan = '01a0bf5d-8f4b-781d-8b8e-bbbbc69c6cc1';
const yaml = `apiVersion: crewstation/v2\nkind: DigitalWorker\nspec:\n  service: { command: [bun, run, main.ts], port: 3000, healthPath: /healthz, servicePlanId: ${plan}, replicas: 1 }\n  env: [{ name: GREETING, from: config, configDefinitionId: 01a0bf5d-8f4b-7e10-85ed-74d540e5d6c1 }]\n  release:\n    migration: { compatibility: none, destructive: false, rollback: switch-back }\n`;

describe.skipIf(!available)('服务槽由资源中心建出（RFC-025 T8）', () => {
  let tdb: TestDatabase;
  let resources: ResourcesModule;
  let release: ReleaseModule;
  let k8s: FakeK8sClient;
  let version = 0, configVersion = 7;
  const dryRuns: Array<{ spec: { children: readonly { name: string }[]; slot: Readonly<Record<string, unknown>> }; env: Readonly<Record<string, string>> }> = [];

  beforeAll(async () => {
    tdb = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, releaseMigrations]);
    k8s = createFakeK8sClient();
    resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    release = createReleaseModule({
      db: tdb.db, k8s, isAdmin: async (id) => id === admin.userId, authorizer: { authorize: async () => {} },
      ledger: { within: (tx) => resources.api.owner('release').within(tx as object) }, creation: 'ledger', renderer: { dryRun: async (spec, env) => { dryRuns.push({ spec, env }); } },
      tagger: { createReleaseTag: async () => ({ tag: `v0.0.${++version}`, commitSha: `sha-${version}` }) },
      repo: { readFile: async (_s, _r, path) => (path === 'crewstation.yaml' ? yaml : undefined), repositoryUrl: async () => ({ httpUrl: 'https://repo.invalid/shop', credentialSecretName: 'shop-git' }) },
      services: { resolveServiceById: async () => ({ projectId, slug: 'shop', name: 'shop', namespace: 'cs-shop' }) },
      plans: { getServicePlan: async () => ({ id: plan, name: 'small', cpu: '1', memory: '1Gi', maxReplicas: 3, description: '' }), lookupComputeProfile: async () => undefined, listComputeProfiles: async () => [] },
      config: { render: async () => ({ values: { '01a0bf5d-8f4b-7e10-85ed-74d540e5d6c1': 'hi' }, version: configVersion }), validate: async () => ({ missing: [] }) },
      data: { envFor: async () => ({ CS_DATABASE_URL: 'postgres://prod' }) }, hosts: { prodHost: () => 'prod.invalid', previewHost: () => 'preview.invalid' },
      maintenance: { open: async () => false }, owners: { ownerOf: async () => admin.userId }, notifier: { notify: async () => {} },
      settings: { registryBase: 'registry', buildTimeoutSeconds: 10, deployTimeoutSeconds: 300, builderImage: 'builder', buildkitAddress: 'buildkit', workerOwner: 'ledger-slot-test', serviceDomain: 'svc.internal', userDomain: 'user.invalid' },
    });
  });
  afterAll(async () => { await tdb.drop(); });

  const record = async (physical: 'blue' | 'green') => {
    const listed = (await resources.api.list({ kind: 'service-slot', includeStopped: true })).find((entry) => entry.owner.ref === `${serviceId}/${physical}`)!;
    return (await resources.api.get(listed.id))!;
  };
  const slotOf = async (physical: 'blue' | 'green') => (await record(physical)).spec['slot'] as { releaseId: string; revision: number; replicas: number; restartedAt?: string; envSecret: string };
  /** 模拟调和器：照记录的期望向 release 要环境，把 Deployment 落到假集群，写一条观测（stale 表示观测到的还是上一版期望）。 */
  const reconcile = async (physical: 'blue' | 'green', stale = false) => {
    const current = await record(physical), slot = current.spec['slot'] as { releaseId: string; revision: number; replicas: number };
    const values = await release.api.slotEnvValues({ recordId: current.id, serviceId, physical, releaseId: slot.releaseId, revision: slot.revision });
    const live = await k8s.apply({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: `shop-${physical}`, namespace: 'cs-shop', labels: { 'crewstation.io/release': slot.releaseId } }, spec: { replicas: slot.replicas } } as K8sObject);
    await resources.api.observe({ child: { kind: 'Deployment', namespace: 'cs-shop', name: `shop-${physical}`, uid: live.metadata.uid!, phase: 'Available', ready: true, replicas: slot.replicas, readyReplicas: slot.replicas, appliedGeneration: stale ? current.generation - 1 : current.generation } });
    return values;
  };
  const publish = async (): Promise<ReleaseId> => {
    const rel = await release.api.publish(admin, serviceId, { branch: 'main', version: 'patch' });
    await release.api.runPipelineStep(rel.id);
    await k8s.mergePatch(Resources.Job!, `build-${rel.id.replaceAll('-', '')}`, 'cs-shop', { status: { succeeded: 1 } });
    await release.api.runPipelineStep(rel.id);
    return rel.id;
  };
  const command = async (action: ClusterAction, replicas?: number) => {
    const live = (await k8s.get(Resources.Deployment!, 'shop-green', 'cs-shop'))!, slot = (await release.api.listClusterSlots()).find((entry) => entry.physical === 'green')!;
    const row = { resourceId: 'resource', uid: live.metadata.uid!, apiVersion: 'apps/v1', kind: 'Deployment', name: 'shop-green', namespace: 'cs-shop', resourceVersion: live.metadata.resourceVersion!, revision: 'r', observedAt: new Date().toISOString(), view: 'workloads', ownership: { scope: 'project', projectId, projectName: 'Shop', slug: 'shop', projectKind: 'DigitalWorker', archived: false }, purpose: 'digital-worker-service', phase: 'Active', ready: true, abnormal: false, reason: '', topLevel: true, standalone: false, restarts: 0, labels: {}, owners: [], references: [], containers: [], facts: {}, serviceId, physicalSlot: 'green', slotRole: slot.role, domainRevision: slot.revision, availableActions: (['restart', 'scale', 'restore-replicas', 'delete'] as const).map((entry) => ({ action: entry, enabled: true, executionRoute: 'release', reason: '', impactSummary: [] })) } as ClusterResource;
    const request = { action, ...(replicas === undefined ? {} : { replicas }) }, checked = await release.api.inspectSlotOperation(admin, row, request);
    const inspection: ClusterInspection = { ...checked, inspectionId: crypto.randomUUID(), expiresAt: new Date(Date.now() + 300_000).toISOString(), target: row, request, related: [] };
    const op: ClusterOperation = { operationId: crypto.randomUUID(), inspectionId: inspection.inspectionId, idempotencyKey: crypto.randomUUID(), actorId: admin.userId, action, target: row, params: request, phase: 'executing', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), durationMs: 0, traceId: 'trace', httpStatus: 202, reason: '' };
    return { op, inspection };
  };

  test('部署只写期望：台账里是渲染输入与环境 Secret 名、没有配置与密钥；环境建的时候才要，实际用上的配置版本记回发布；观测是新期望的才算铺完', async () => {
    const id = await publish();
    expect((await release.api.getRelease(admin, id)).status).toBe('deploying');
    expect(k8s.applied.filter((object) => object.kind === 'Deployment' || object.kind === 'Service')).toEqual([]);
    const green = await record('green');
    expect(green.spec.children.map((child) => `${child.kind}/${child.name}`)).toEqual(['Deployment/shop-green', 'Service/shop-green', 'Secret/shop-green-env-1']);
    expect(green.spec['slot']).toMatchObject({ serviceId, project: 'shop', service: 'shop', physical: 'green', releaseId: id, revision: 1, image: 'registry/shop:v0.0.1', command: ['bun', 'run', 'main.ts'], port: 3000, replicas: 1, resources: { cpu: '1', memory: '1Gi' }, envSecret: 'shop-green-env-1' });
    expect(JSON.stringify(green)).not.toContain('postgres://prod');
    // 调和器还没应用、或观测到的还是上一版期望：都不算铺完。
    expect(await release.api.runPipelineStep(id)).toEqual({ done: false, retryAfterSeconds: 5 });
    configVersion = 8;
    const values = await reconcile('green', true);
    expect(values).toMatchObject({ CS_DATABASE_URL: 'postgres://prod', GREETING: 'hi', CS_SLOT: 'green' });
    expect((await release.api.getRelease(admin, id)).configVersion).toBe(8);
    expect((await release.api.runPipelineStep(id)).done).toBe(false);
    await reconcile('green');
    expect((await release.api.runPipelineStep(id)).done).toBe(true);
    expect(await release.api.getRelease(admin, id)).toMatchObject({ status: 'ready' });
    expect((await release.api.getSlots(admin, serviceId)).find((slot) => slot.name === 'preview')).toMatchObject({ state: 'ready', releaseId: id });
  });

  test('建不成：调和器报来之后流水线判失败，原因进发布记录与槽记录；不是这一次部署的环境请求与失败报告都不算数', async () => {
    const id = await publish();
    const slot = await slotOf('green'), current = await record('green');
    expect(slot).toMatchObject({ releaseId: id, revision: 2, envSecret: 'shop-green-env-2' });
    const stale = { recordId: current.id, serviceId, physical: 'green' as const, releaseId: id, revision: 1 };
    expect(await release.api.slotEnvValues(stale).then(() => 'given', (error: { kind?: string }) => error.kind)).toBe('precondition');
    await release.api.slotFailed(stale, '旧的那一次');
    expect((await release.api.runPipelineStep(id)).done).toBe(false);
    await release.api.slotFailed({ ...stale, revision: 2 }, 'admission webhook denied');
    expect((await release.api.runPipelineStep(id)).done).toBe(true);
    expect(await release.api.getRelease(admin, id)).toMatchObject({ status: 'failed', message: '待命槽部署失败：admission webhook denied' });
    expect((await record('green')).conditions.find((entry) => entry.type === 'Failed')).toMatchObject({ status: 'true', message: '部署未能就绪：admission webhook denied' });
  });

  test('集群管理的扩缩与重启改期望、照槽记录判完成；项目侧下线与重新部署同样只改期望（重新部署前按期望 dry-run）', async () => {
    const id = await publish();
    await reconcile('green');
    await release.api.runPipelineStep(id);
    const scale = await command('scale', 2);
    expect(scale.inspection.capability.enabled).toBe(true);
    const before = (await record('green')).generation;
    await release.api.executeSlotOperation(admin, scale.op, scale.inspection);
    expect(await slotOf('green')).toMatchObject({ replicas: 2, revision: 3 });
    expect((await record('green')).generation).toBe(before + 1);
    expect((await release.api.observeSlotOperation(scale.op)).done).toBe(false);
    await reconcile('green');
    expect((await release.api.observeSlotOperation(scale.op)).done).toBe(true);
    expect((await release.api.listClusterSlots()).find((entry) => entry.physical === 'green')?.overrideReplicas).toBe(2);
    const restart = await command('restart');
    await release.api.executeSlotOperation(admin, restart.op, restart.inspection);
    expect((await slotOf('green')).restartedAt).toBeString();
    expect((await release.api.observeSlotOperation(restart.op)).done).toBe(false);
    await reconcile('green');
    expect((await release.api.observeSlotOperation(restart.op)).done).toBe(true);
    // 项目侧下线：工作负载由调和器删，release 不动集群；期望留着，调和器据此知道删哪些。
    const deletions = k8s.deleted.length;
    await release.api.takeOffline(admin, serviceId, { expectedReleaseId: id });
    expect(k8s.deleted.length).toBe(deletions);
    const offline = await record('green');
    expect(offline.conditions.find((entry) => entry.type === 'Serving')).toMatchObject({ status: 'false', reason: 'offline-manual' });
    expect(offline.spec['slot']).toMatchObject({ releaseId: id, revision: 3 });
    await resources.api.observe({ child: { kind: 'Deployment', namespace: 'cs-shop', name: 'shop-green', phase: 'absent', ready: false }, gone: true });
    // 重新部署：预检的是要写进台账的期望（下一次 revision 与它的环境），确认后只改期望。
    expect((await release.api.redeployPrecheck(admin, id)).ok).toBe(true);
    expect(dryRuns.at(-1)?.spec.children.map((child) => child.name)).toEqual(['shop-green', 'shop-green', 'shop-green-env-4']);
    expect(dryRuns.at(-1)?.env).toMatchObject({ GREETING: 'hi' });
    const applied = k8s.applied.length;
    await release.api.redeploy(admin, id, { expectedStandbyReleaseId: null });
    expect(k8s.applied.length).toBe(applied);
    expect(await slotOf('green')).toMatchObject({ releaseId: id, revision: 4, replicas: 2, envSecret: 'shop-green-env-4' });
    await reconcile('green');
    expect((await release.api.runPipelineStep(id)).done).toBe(true);
    expect((await release.api.getRelease(admin, id)).status).toBe('ready');
  });

  test('集群管理删除待命槽即下线：受理时改期望（原因记集群管理），Deployment 没了才算完成', async () => {
    const standby = (await release.api.getSlots(admin, serviceId)).find((slot) => slot.name === 'preview')!;
    const del = await command('delete');
    expect(del.inspection.capability.enabled).toBe(true);
    await release.api.executeSlotOperation(admin, del.op, del.inspection);
    expect((await release.api.getSlots(admin, serviceId)).find((slot) => slot.name === 'preview')?.offline).toMatchObject({ releaseId: standby.releaseId, reason: 'cluster', actorUserId: admin.userId });
    expect((await record('green')).conditions.find((entry) => entry.type === 'Serving')).toMatchObject({ status: 'false', reason: 'offline-cluster' });
    expect((await release.api.observeSlotOperation(del.op)).done).toBe(false);
    await resources.api.observe({ child: { kind: 'Deployment', namespace: 'cs-shop', name: 'shop-green', phase: 'absent', ready: false }, gone: true });
    expect((await release.api.observeSlotOperation(del.op)).done).toBe(true);
    expect(await release.api.getRelease(admin, standby.releaseId as ReleaseId)).toMatchObject({ status: 'offline', redeployable: true });
  });
});
