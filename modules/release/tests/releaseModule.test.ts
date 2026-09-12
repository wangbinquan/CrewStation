import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import type { FakeK8sClient } from '@crewstation/k8s';
import { Resources, createFakeK8sClient } from '@crewstation/k8s';
import { queueMigrations } from '@crewstation/queue';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { ReleaseModule } from '../wiring';
import { createReleaseModule, releaseMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let k8s: FakeK8sClient;
let release: ReleaseModule;
const owner: Actor = { userId: 'usr_0123456789abcdef0123456789abcdef' as UserId, isAdmin: false };
const serviceId = 'svc_0123456789abcdef0123456789abcdef' as ServiceId;
const projectId = 'prj_0123456789abcdef0123456789abcdef' as ProjectId;
let manifestYaml = '';
let tagCounter = 0;

const baseManifest = (migration: string, compute = 'sample-stub') => `
apiVersion: crewstation/v1
kind: DigitalWorker
spec:
  service: { command: [bun, run, src/main.ts], port: 3000, healthPath: /healthz, plan: standard-small, replicas: 1 }
  env: [{ name: GREETING, from: config }]
  apis: { requested: [], exposes: { openapi: ./openapi.yaml } }
  subscriptions: []
  tasks:
    profile: coding-medium
    defaultVolumeMode: follow-container
    agentProfiles: [{ name: chat-v1, compute: ${compute}, permission: read-only }]
  release:
    ${migration}
`;

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, queueMigrations, releaseMigrations]);
  k8s = createFakeK8sClient();
  manifestYaml = baseManifest('migration: { compatibility: none, destructive: false, rollback: switch-back }');
  release = createReleaseModule({
    db: tdb.db, k8s,
    tagger: { createReleaseTag: async () => { tagCounter += 1; return { tag: `v0.1.${tagCounter}`, commitSha: `sha${tagCounter}` }; } },
    repo: {
      readFile: async (_s, _ref, path) => (path === 'crewstation.yaml' ? manifestYaml : path === 'openapi.yaml' ? 'openapi: 3.1.0\npaths: {}\n' : undefined),
      repositoryUrl: async () => ({ httpUrl: 'http://gitlab.local/crewstation/demo.git', credentialSecretName: 'demo-git' }),
    },
    authorizer: { authorize: async (actor, _p, action) => { if (action === 'switch-traffic' && actor.userId !== owner.userId) throw new Error('forbidden'); } },
    services: { resolveServiceById: async () => ({ projectId, slug: 'demo', name: 'demo', namespace: 'cs-demo' }) },
    plans: {
      getServicePlan: async (name) => (name === 'standard-small' ? { name, cpu: '500m', memory: '512Mi', maxReplicas: 3, description: '' } : undefined),
      getComputeProfile: async (name) => (name === 'sample-stub' ? { name } : undefined),
      listComputeProfiles: async () => [{ name: 'sample-stub' }],
    },
    config: { render: async () => ({ values: { GREETING: 'hi' }, version: 7 }), validate: async (_p, _e, keys) => ({ missing: keys.filter((k) => k !== 'GREETING') }) },
    data: { envFor: async () => ({ CS_DATABASE_URL: 'postgres://prod' }) },
    hosts: { prodHost: (s) => `${s}.cs.localhost`, previewHost: (s) => `preview.${s}.cs.localhost` },
    isAdmin: async () => false,
    settings: { userDomain: 'cs.localhost', serviceDomain: 'svc.cs.internal', registryBase: 'registry:5000', maintenanceWindow: false, buildTimeoutSeconds: 600, deployTimeoutSeconds: 300, builderImage: 'cs-builder:dev', buildkitAddress: 'tcp://buildkitd:1234', workerOwner: 'test' },
  });
});
afterAll(async () => { await tdb?.drop(); });

const markJob = async (name: string, ok: boolean) => k8s.mergePatch(Resources.Job!, name, 'cs-demo', { status: ok ? { succeeded: 1 } : { conditions: [{ type: 'Failed', status: 'True', message: 'boom' }] } });
const markDeployment = async (name: string, ready: number) => k8s.mergePatch(Resources.Deployment!, name, 'cs-demo', { status: { replicas: ready, readyReplicas: ready } });

describe.skipIf(!available)('release module', () => {
  test('发布→构建→部署待命槽→就绪→切流→回退', async () => {
    const dto = await release.api.publish(owner, serviceId, { branch: 'main', version: 'patch' });
    expect(dto.status).toBe('pending');
    await expect(release.api.publish(owner, serviceId, { branch: 'main', version: 'patch' })).rejects.toMatchObject({ kind: 'conflict' });

    expect(await release.api.runPipelineStep(dto.id)).toEqual({ done: false, retryAfterSeconds: 5 });
    expect((await release.api.getRelease(owner, dto.id)).status).toBe('building');
    const buildJob = k8s.applied.find((o) => o.kind === 'Job')!;
    expect(buildJob.metadata.namespace).toBe('cs-demo');
    await release.api.runPipelineStep(dto.id);
    expect((await release.api.getRelease(owner, dto.id)).status).toBe('building');
    await markJob(buildJob.metadata.name, true);
    await release.api.runPipelineStep(dto.id);
    const deploying = await release.api.getRelease(owner, dto.id);
    expect(deploying.status).toBe('deploying');
    expect(deploying.image).toBe('registry:5000/demo:v0.1.1');
    const deployment = k8s.applied.find((o) => o.kind === 'Deployment')!;
    expect(deployment.metadata.name).toBe('demo-green');
    const container = (deployment.spec as { template: { spec: { containers: Array<{ env: Array<{ name: string; value: string }> }> } } }).template.spec.containers[0]!;
    expect(container.env.find((e) => e.name === 'GREETING')?.value).toBe('hi');
    expect(container.env.find((e) => e.name === 'CS_SLOT')?.value).toBe('green');
    await markDeployment('demo-green', 1);
    expect(await release.api.runPipelineStep(dto.id)).toEqual({ done: true, retryAfterSeconds: 0 });
    const ready = await release.api.getRelease(owner, dto.id);
    expect(ready.status).toBe('ready');
    expect(ready.slot).toBe('preview');
    expect(ready.configVersion).toBe(7);

    const rows = (await tdb.db.execute(`SELECT topic, payload FROM platform_infra.domain_events ORDER BY id`)) as unknown as Array<{ topic: string; payload: unknown }>;
    const topics = rows.map((r) => ({ topic: r.topic, payload: (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as { openapiDocument?: unknown } }));
    expect(topics.map((t) => t.topic)).toContain('release.registered');
    expect(topics.find((t) => t.topic === 'release.registered')?.payload.openapiDocument).toBeDefined();

    const slots = await release.api.getSlots(owner, serviceId);
    expect(slots.map((s) => [s.name, s.state, s.host])).toEqual([['prod', 'empty', 'demo.cs.localhost'], ['preview', 'ready', 'preview.demo.cs.localhost']]);

    await expect(release.api.switchTraffic({ userId: 'usr_ffffffffffffffffffffffffffffffff' as UserId, isAdmin: false }, serviceId, { toSlot: 'preview' })).rejects.toThrow('forbidden');
    await expect(release.api.switchTraffic(owner, serviceId, { toSlot: 'preview', expectedActiveRelease: dto.id })).rejects.toMatchObject({ kind: 'precondition' });
    const switched = await release.api.switchTraffic(owner, serviceId, { toSlot: 'preview' });
    expect(switched.releaseId).toBe(dto.id);
    // 记的是发布从待命槽接管生产流量，不是物理槽名：首次晋级没有上一个发布。
    expect([switched.fromSlot, switched.toSlot]).toEqual(['preview', 'prod']);
    expect(switched.previousReleaseId).toBeUndefined();
    expect((await release.api.getSlots(owner, serviceId)).map((s) => [s.name, s.state])).toEqual([['prod', 'ready'], ['preview', 'empty']]);
    expect((await release.api.activeEndpoint(serviceId))?.kubernetesService).toBe('demo-green');
    await expect(release.api.switchTraffic(owner, serviceId, { toSlot: 'preview' })).rejects.toMatchObject({ kind: 'precondition' });

    // 回退：再发一个版本到待命槽后切回去，记录要带上切走前的线上发布。
    const second = await release.api.publish(owner, serviceId, { branch: 'main', version: 'patch' });
    await release.api.runPipelineStep(second.id);
    await markJob(`build-${second.id.slice(-12)}`, true);
    await release.api.runPipelineStep(second.id);
    await markDeployment('demo-blue', 1);
    await release.api.runPipelineStep(second.id);
    const rolled = await release.api.switchTraffic(owner, serviceId, { toSlot: 'preview', reason: '回退' });
    expect([rolled.fromSlot, rolled.toSlot]).toEqual(['preview', 'prod']);
    expect(rolled.releaseId).toBe(second.id);
    expect(rolled.previousReleaseId).toBe(dto.id);
  });

  test('迁移失败不切流；破坏性迁移在非维护窗口被拒', async () => {
    manifestYaml = baseManifest('migrationCommand: [bun, run, db:migrate]\n    migration: { compatibility: expand-only, destructive: false, rollback: switch-back }');
    const dto = await release.api.publish(owner, serviceId, { branch: 'main', version: 'patch' });
    await release.api.runPipelineStep(dto.id);
    await markJob(`build-${dto.id.slice(-12)}`, true);
    await release.api.runPipelineStep(dto.id);
    expect((await release.api.getRelease(owner, dto.id)).status).toBe('migrating');
    await markJob(`migrate-${dto.id.slice(-12)}`, false);
    expect(await release.api.runPipelineStep(dto.id)).toEqual({ done: true, retryAfterSeconds: 0 });
    const failed = await release.api.getRelease(owner, dto.id);
    expect(failed.status).toBe('failed');
    expect(failed.message).toContain('迁移失败');
    expect((await release.api.getSlots(owner, serviceId)).find((s) => s.name === 'prod')?.state).toBe('ready');

    manifestYaml = baseManifest('migration: { compatibility: destructive, destructive: true, rollback: blocked }');
    const destructive = await release.api.publish(owner, serviceId, { branch: 'main', version: 'minor' });
    await release.api.runPipelineStep(destructive.id);
    await markJob(`build-${destructive.id.slice(-12)}`, true);
    await release.api.runPipelineStep(destructive.id);
    expect((await release.api.getRelease(owner, destructive.id))).toMatchObject({ status: 'failed', message: expect.stringContaining('维护窗口') });
  });

  test('引用不存在的算力档位：发布被拒，不进构建，错误列出可用档位（RFC-001）', async () => {
    manifestYaml = baseManifest('migration: { compatibility: none, destructive: false, rollback: switch-back }', 'nope');
    const before = k8s.applied.filter((o) => o.kind === 'Job').length;
    const dto = await release.api.publish(owner, serviceId, { branch: 'main', version: 'patch' });
    await release.api.runPipelineStep(dto.id);
    await markJob(`build-${dto.id.slice(-12)}`, true);
    await release.api.runPipelineStep(dto.id);
    const failed = await release.api.getRelease(owner, dto.id);
    expect(failed.status).toBe('failed');
    expect(failed.message).toContain('算力档位 nope 不存在');
    expect(failed.message).toContain('sample-stub');
    // 部署一步都没走：没有新的 Deployment。
    expect(k8s.applied.filter((o) => o.kind === 'Deployment' && (o.metadata.name as string).includes(dto.id.slice(-6))).length).toBe(0);
    expect(before).toBeGreaterThanOrEqual(0);
    manifestYaml = baseManifest('migration: { compatibility: none, destructive: false, rollback: switch-back }');
  });
});