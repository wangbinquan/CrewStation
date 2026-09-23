import { BUILTIN_RESOURCES } from '@crewstation/contracts';
const computeIds = new Map<string, string>();
const computeId = (name: string): string => { if (!computeIds.has(name)) computeIds.set(name, Bun.randomUUIDv7()); return computeIds.get(name)!; };
const computeSelector = (name: string) => name === 'default' ? { kind: 'default' as const } : { kind: 'profile' as const, profileId: computeId(name) };
import { forbidden } from '@crewstation/kernel';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { Actor, ProjectId, ReleaseId, ServiceId, UserId } from '@crewstation/contracts';
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
const owner: Actor = { userId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' as UserId, isAdmin: false };
const serviceId = '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb' as ServiceId;
const projectId = '01a0bf5d-8f4b-7178-82e1-9a99060b1192' as ProjectId;
let manifestYaml = '';
let tagCounter = 0;
let defaultProfile: string | undefined = 'balanced';
let servicePlanAllowed = true;

const baseManifest = (migration: string, compute = 'default') => `
apiVersion: crewstation/v2
kind: DigitalWorker
spec:
  service: { command: [bun, run, src/main.ts], port: 3000, healthPath: /healthz, servicePlanId: ${BUILTIN_RESOURCES.servicePlanSmall}, replicas: 1 }
  env: [{ name: GREETING, from: config, configDefinitionId: 01a0bf5d-8f4b-7e10-85ed-74d540e5d6f8 }]
  apis: { requested: [], exposes: { openapi: ./openapi.yaml } }
  subscriptions: []
  tasks:
    taskProfileId: ${BUILTIN_RESOURCES.taskProfileMedium}
    defaultVolumeMode: follow-container
    agentProfiles: [{ id: 01a0bf5d-8f4b-761b-8fff-2cf4dc4f242f, name: chat-v1, compute: ${JSON.stringify(computeSelector(compute))}, permission: read-only }]
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
    tagger: { createReleaseTag: async (_service, input) => { tagCounter += 1; return { tag: `v0.1.${tagCounter}`, commitSha: input.expectedCommitSha ?? `sha${tagCounter}` }; } },
    repo: {
      readFile: async (_s, _ref, path) => (path === 'crewstation.yaml' ? manifestYaml : path === 'openapi.yaml' ? 'openapi: 3.1.0\npaths: {}\n' : undefined),
      repositoryUrl: async () => ({ httpUrl: 'http://gitlab.local/crewstation/demo.git', credentialSecretName: 'demo-git' }),
    },
    authorizer: { authorize: async (actor, _p, action) => { if (action === 'switch-traffic' && actor.userId !== owner.userId) throw new Error('forbidden'); } },
    services: { resolveServiceById: async () => ({ projectId, slug: 'demo', name: 'demo', namespace: 'cs-demo' }) },
    plans: {
      getServicePlan: async (id, project) => {
        if (project && !servicePlanAllowed) { expect(project).toBe(projectId); throw forbidden('项目未获分配服务规格'); }
        return id === BUILTIN_RESOURCES.servicePlanSmall ? { id, name: 'standard-small', cpu: '500m', memory: '512Mi', maxReplicas: 3, description: '' } : undefined;
      },
      lookupComputeProfile: async (selector, id) => { expect(id).toBe(projectId); const name = selector.kind === "default" ? "default" : [...computeIds].find(([, value]) => value === selector.profileId)?.[0]; if (name === 'private') throw forbidden('项目未获授权使用 private 档位'); return (name === 'default' ? (defaultProfile ? { name: defaultProfile, terminalOnly: false } : undefined) : name === 'balanced' ? { name, terminalOnly: false } : name === 'term-cli' ? { name, terminalOnly: true } : undefined); },
      listComputeProfiles: async () => ['balanced', 'term-cli'],
    },
    config: { render: async () => ({ values: { '01a0bf5d-8f4b-7e10-85ed-74d540e5d6f8': 'hi' }, version: 7 }), validate: async (_p, _e, keys) => ({ missing: keys.filter((k) => k !== '01a0bf5d-8f4b-7e10-85ed-74d540e5d6f8') }) },
    data: { envFor: async () => ({ CS_DATABASE_URL: 'postgres://prod' }) },
    hosts: { prodHost: (s) => `${s}.cs.localhost`, previewHost: (s) => `preview.${s}.cs.localhost` },
    isAdmin: async () => false,
    // RFC-021：项目完整维护（破坏性迁移窗口）由 gateway 经装配提供；这里的场景一律不在维护中，放行路径见 slotLifecycle.test.ts。
    maintenance: { open: async () => false },
    owners: { ownerOf: async () => owner.userId },
    notifier: { notify: async () => {} },
    settings: { userDomain: 'cs.localhost', serviceDomain: 'svc.cs.internal', registryBase: 'registry:5000', buildTimeoutSeconds: 600, deployTimeoutSeconds: 300, builderImage: 'cs-builder:dev', buildkitAddress: 'tcp://buildkitd:1234', workerOwner: 'test' },
  });
});
afterAll(async () => { await tdb?.drop(); });

const markJob = async (name: string, ok: boolean) => k8s.mergePatch(Resources.Job!, name, 'cs-demo', { status: ok ? { succeeded: 1 } : { conditions: [{ type: 'Failed', status: 'True', message: 'boom' }] } });
const markDeployment = async (name: string, ready: number) => k8s.mergePatch(Resources.Deployment!, name, 'cs-demo', { status: { replicas: ready, readyReplicas: ready } });

describe.skipIf(!available)('release module', () => {
  test('发布→构建→部署待命槽→就绪→切流→回退', async () => {
    const dto = await release.api.publish(owner, serviceId, { branch: 'main', version: 'patch', expectedCommitSha: 'a'.repeat(40) });
    expect(dto.status).toBe('pending');
    expect(dto.commitSha).toBe('a'.repeat(40));
    await expect(release.api.publish(owner, serviceId, { branch: 'main', version: 'patch' })).rejects.toMatchObject({ kind: 'conflict' });

    expect(await release.api.runPipelineStep(dto.id)).toEqual({ done: false, retryAfterSeconds: 5 });
    expect((await release.api.getRelease(owner, dto.id)).status).toBe('building');
    const buildJob = k8s.applied.find((o) => o.kind === 'Job')!;
    expect(buildJob.metadata.namespace).toBe('cs-demo');
    // 构建 Pod 只跑 git clone 与 buildctl 客户端，按这个负载请求资源（实际构建在 buildkitd）。
    expect((buildJob.spec as { template: { spec: { containers: Array<{ resources: unknown }> } } }).template.spec.containers[0]!.resources)
      .toEqual({ requests: { cpu: '250m', memory: '512Mi' }, limits: { cpu: '250m', memory: '512Mi' } });
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

    await expect(release.api.switchTraffic({ userId: '01a0bf5d-8f4b-72ed-8b3d-1ceb06a30ca3' as UserId, isAdmin: false }, serviceId, { toSlot: 'preview' })).rejects.toThrow('forbidden');
    await expect(release.api.switchTraffic(owner, serviceId, { toSlot: 'preview', expectedActiveRelease: dto.id })).rejects.toMatchObject({ kind: 'precondition' });
    await expect(release.api.switchTraffic(owner, serviceId, { toSlot: 'preview', expectedActiveRelease: null, expectedTargetRelease: '01a0bf5d-8f4b-7c03-891e-3d6d1b2b3fdb' as ReleaseId })).rejects.toMatchObject({ kind: 'precondition' });
    const switched = await release.api.switchTraffic(owner, serviceId, { toSlot: 'preview', expectedActiveRelease: null, expectedTargetRelease: dto.id });
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
    await markJob(`build-${second.id.replaceAll('-', '')}`, true);
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
    await markJob(`build-${dto.id.replaceAll('-', '')}`, true);
    await release.api.runPipelineStep(dto.id);
    expect((await release.api.getRelease(owner, dto.id)).status).toBe('migrating');
    await markJob(`migrate-${dto.id.replaceAll('-', '')}`, false);
    expect(await release.api.runPipelineStep(dto.id)).toEqual({ done: true, retryAfterSeconds: 0 });
    const failed = await release.api.getRelease(owner, dto.id);
    expect(failed.status).toBe('failed');
    expect(failed.message).toContain('迁移失败');
    expect((await release.api.getSlots(owner, serviceId)).find((s) => s.name === 'prod')?.state).toBe('ready');

    manifestYaml = baseManifest('migration: { compatibility: destructive, destructive: true, rollback: blocked }');
    const count = (await release.api.listReleases(owner, serviceId)).length;
    // RFC-021 M14、M17：维护窗口＝项目维护中且三个开关都拦；拒绝原因说清出路。RFC-025 统一预检：发布受理时就拒绝，不打标签、不登记发布。
    try {
      await expect(release.api.publish(owner, serviceId, { branch: 'main', version: 'minor' })).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('只能在项目维护期间发布'), details: { code: 'maintenance-window-required' } });
      expect(await release.api.listReleases(owner, serviceId)).toHaveLength(count);
    } finally { manifestYaml = baseManifest('migration: { compatibility: none, destructive: false, rollback: switch-back }'); }
  });

  /** 发布只看档位存在性与协议（RFC-006 §4.4）：四种拒绝都在发布受理时发生（RFC-025 统一预检），不打标签、不登记发布，更不会部署半截。 */
  test.each([
    ['private', '未获授权', 'private', 'profile-denied'],
    ['nope', '算力档位 nope 不存在', 'balanced', 'profile-missing'],
    ['term-cli', '通用终端协议', '「＋ CLI」', 'profile-terminal-only'],
    ['default', '尚未设置默认档位', '平台管理', 'profile-default-unset'],
  ])('算力档位 %s：发布被拒，不进部署（RFC-001、RFC-006）', async (compute, first, second, code) => {
    if (compute === 'default') defaultProfile = undefined;
    manifestYaml = baseManifest('migration: { compatibility: none, destructive: false, rollback: switch-back }', compute);
    const count = (await release.api.listReleases(owner, serviceId)).length, tags = tagCounter, deployments = k8s.applied.filter((o) => o.kind === 'Deployment').length;
    try {
      const refused = release.api.publish(owner, serviceId, { branch: 'main', version: 'patch' });
      await expect(refused).rejects.toMatchObject({ kind: 'precondition', details: { code } });
      const message = await refused.catch((error: Error) => error.message);
      expect(message).toContain(compute === 'nope' ? `算力档位 ${computeId(compute)} 不存在` : first);
      expect(message).toContain(second);
      expect(await release.api.listReleases(owner, serviceId)).toHaveLength(count);
      expect(tagCounter).toBe(tags);
      expect(k8s.applied.filter((o) => o.kind === 'Deployment')).toHaveLength(deployments);
    } finally {
      defaultProfile = 'balanced';
      manifestYaml = baseManifest('migration: { compatibility: none, destructive: false, rollback: switch-back }');
    }
  });

  test('项目未获分配服务规格时，发布受理时就拒绝（套餐不可用），不打标签、不构建、不先运行数据迁移', async () => {
    servicePlanAllowed = false;
    manifestYaml = baseManifest('migrationCommand: [bun, run, db:migrate]\n    migration: { compatibility: expand-only, destructive: false, rollback: switch-back }');
    const count = (await release.api.listReleases(owner, serviceId)).length, jobs = k8s.applied.filter((o) => o.kind === 'Job').length, deployments = k8s.applied.filter((o) => o.kind === 'Deployment').length;
    try {
      await expect(release.api.publish(owner, serviceId, { branch: 'main', version: 'patch' })).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('未获分配服务规格'), details: { code: 'plan-unavailable' } });
      expect(await release.api.listReleases(owner, serviceId)).toHaveLength(count);
      expect(k8s.applied.filter((o) => o.kind === 'Job')).toHaveLength(jobs);
      expect(k8s.applied.filter((o) => o.kind === 'Deployment')).toHaveLength(deployments);
    } finally { servicePlanAllowed = true; }
  });

  test('迁移期间撤回服务规格，在实际部署前重新检查并保留拒绝原因', async () => {
    manifestYaml = baseManifest('migrationCommand: [bun, run, db:migrate]\n    migration: { compatibility: expand-only, destructive: false, rollback: switch-back }');
    const dto = await release.api.publish(owner, serviceId, { branch: 'main', version: 'patch' });
    const before = k8s.applied.filter((o) => o.kind === 'Deployment').length;
    await release.api.runPipelineStep(dto.id); await markJob(`build-${dto.id.replaceAll('-', '')}`, true); await release.api.runPipelineStep(dto.id);
    expect((await release.api.getRelease(owner, dto.id)).status).toBe('migrating');
    servicePlanAllowed = false;
    try {
      await markJob(`migrate-${dto.id.replaceAll('-', '')}`, true); await release.api.runPipelineStep(dto.id);
      expect(await release.api.getRelease(owner, dto.id)).toMatchObject({ status: 'failed', message: expect.stringContaining('未获分配服务规格') });
      expect(k8s.applied.filter((o) => o.kind === 'Deployment')).toHaveLength(before);
    } finally { servicePlanAllowed = true; }
  });

  test('两个槽当前版本引用的档位按 UUID 列出，经 default 的不计（RFC-006 P8）', async () => {
    manifestYaml = baseManifest('migration: { compatibility: none, destructive: false, rollback: switch-back }', 'balanced');
    const dto = await release.api.publish(owner, serviceId, { branch: 'main', version: 'patch' });
    for (let i = 0; i < 6; i += 1) {
      await release.api.runPipelineStep(dto.id);
      await markJob(`build-${dto.id.replaceAll('-', '')}`, true);
    }
    expect(await release.api.deployedComputeReferences(serviceId)).toContain(computeId('balanced'));
    expect(await release.api.deployedComputeReferences(serviceId)).not.toContain('default');
    // UUID 升级保留的早期 stub 快照没有 compute；它不能使全局档位详情／创建报 500，也不能被改指向默认档位。
    const legacy = { id: Bun.randomUUIDv7(), name: 'historical-stub', driver: 'stub', model: 'stub/echo', permission: 'read-only' };
    await tdb.db.execute(sql`UPDATE release.releases SET manifest = jsonb_set(manifest, '{spec,tasks,agentProfiles}', (manifest #> '{spec,tasks,agentProfiles}') || ${JSON.stringify([legacy])}::text::jsonb) WHERE id = ${dto.id}`);
    expect(await release.api.deployedComputeReferences(serviceId)).toEqual([computeId('balanced')]);
    const snapshot = await tdb.db.execute(sql`SELECT manifest #> '{spec,tasks,agentProfiles}' AS profiles FROM release.releases WHERE id = ${dto.id}`) as unknown as { profiles: unknown[] }[];
    expect(snapshot[0]!.profiles.at(-1)).toEqual(legacy);
    manifestYaml = baseManifest('migration: { compatibility: none, destructive: false, rollback: switch-back }');
  });
});
