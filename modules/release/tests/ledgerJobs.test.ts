import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, ReleaseId, ServiceId, UserId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import type { FakeK8sClient } from '@crewstation/k8s';
import { createFakeK8sClient } from '@crewstation/k8s';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { queueMigrations } from '@crewstation/queue';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { ReleaseModule } from '../wiring';
import { createReleaseModule, releaseMigrations } from '../wiring';

// RFC-025 T8：构建、迁移 Job 由资源中心建出——流水线只写期望（镜像、命令、不含凭据的明文变量、凭据 Secret 名），凭据在调和器建 Secret 时
// 向 release 要（构建的 Git 令牌、迁移的槽环境）；结果照 Job 记录判（Finished、Created），时限兜底，放弃时给记录报 Failed。调和器由用例模拟。
const available = await testDatabaseAvailable();
const admin: Actor = { userId: '01a0bf5d-8f4b-7210-80c1-302ae945a9d1' as UserId, isAdmin: true };
const serviceId = '01a0bf5d-8f4b-7aea-8983-7b41e8b305d1' as ServiceId, other = '01a0bf5d-8f4b-7aea-8983-7b41e8b305d2' as ServiceId, projectId = '01a0bf5d-8f4b-7710-89f8-83b88c835ed1' as ProjectId;
const plan = '01a0bf5d-8f4b-781d-8b8e-bbbbc69c6cd1';
const yaml = `apiVersion: crewstation/v2\nkind: DigitalWorker\nspec:\n  service: { command: [bun, run, main.ts], port: 3000, healthPath: /healthz, servicePlanId: ${plan}, replicas: 1 }\n  release:\n    migrationCommand: [bun, run, migrate]\n    migration: { compatibility: expand-only, destructive: false, rollback: switch-back }\n`;

describe.skipIf(!available)('构建、迁移 Job 由资源中心建出（RFC-025 T8）', () => {
  let tdb: TestDatabase;
  let resources: ResourcesModule;
  let release: ReleaseModule;
  let k8s: FakeK8sClient;
  let version = 0, tokens = 0, nowMs = Date.parse('2026-09-24T09:00:00.000Z');

  beforeAll(async () => {
    tdb = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, releaseMigrations]);
    k8s = createFakeK8sClient();
    resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    release = createReleaseModule({
      db: tdb.db, k8s, clock: { now: () => new Date(nowMs) }, isAdmin: async (id) => id === admin.userId, authorizer: { authorize: async () => {} },
      ledger: { within: (tx) => resources.api.owner('release').within(tx as object) }, creation: 'ledger', renderer: { dryRun: async () => undefined },
      tagger: { createReleaseTag: async () => ({ tag: `v0.0.${++version}`, commitSha: `sha-${version}` }) },
      repo: {
        readFile: async (_s, _r, path) => (path === 'crewstation.yaml' ? yaml : undefined), repositoryUrl: async () => { throw new Error('资源中心建 Job 时不写按服务共用的 Secret'); },
        buildSource: async () => ({ httpUrl: 'http://gitlab.local/crewstation/jobs.git' }), buildToken: async () => ({ token: `token-${++tokens}` }),
      },
      services: { resolveServiceById: async () => ({ projectId, slug: 'jobs', name: 'jobs', namespace: 'cs-jobs' }) },
      plans: { getServicePlan: async () => ({ id: plan, name: 'small', cpu: '1', memory: '1Gi', maxReplicas: 3, description: '' }), lookupComputeProfile: async () => undefined, listComputeProfiles: async () => [] },
      config: { render: async () => ({ values: {}, version: 3 }), validate: async () => ({ missing: [] }) }, data: { envFor: async () => ({ CS_DATABASE_URL: 'postgres://prod' }) },
      hosts: { prodHost: () => 'prod.invalid', previewHost: () => 'preview.invalid' }, maintenance: { open: async () => false }, owners: { ownerOf: async () => admin.userId }, notifier: { notify: async () => {} },
      settings: { registryBase: 'registry', buildTimeoutSeconds: 600, deployTimeoutSeconds: 300, builderImage: 'cs-builder:1', buildkitAddress: 'tcp://buildkitd:1234', workerOwner: 'ledger-job-test', serviceDomain: 'svc.internal', userDomain: 'user.invalid' },
    });
  });
  afterAll(async () => { await tdb.drop(); });

  const jobRecord = async (releaseId: string, purpose: 'build' | 'migration') => {
    const listed = (await resources.api.list({ kind: purpose === 'build' ? 'build-job' : 'migration-job', includeStopped: true })).find((entry) => entry.owner.ref === `${releaseId}/${purpose}`);
    return listed ? (await resources.api.get(listed.id))! : undefined;
  };
  /** 模拟调和器：照 Job 记录向 release 要凭据，然后记下结果（只归资源中心的条件）。 */
  const finish = async (releaseId: string, purpose: 'build' | 'migration', outcome: 'succeeded' | 'failed' = 'succeeded') => {
    const record = (await jobRecord(releaseId, purpose))!;
    const values = await release.api.jobEnvValues({ recordId: record.id, releaseId, purpose });
    await resources.api.observeConditions(record.id, [{ type: 'Created', status: 'true' }, { type: 'Finished', status: 'true', reason: outcome, message: outcome === 'succeeded' ? '已完成' : 'BackoffLimitExceeded' }]);
    return values;
  };

  test('构建→迁移→部署：Job 只写期望（不含凭据），凭据建的时候才要、只在那一步给；照记录判结果', async () => {
    const rel = await release.api.publish(admin, serviceId, { branch: 'main', version: 'patch' });
    await release.api.runPipelineStep(rel.id);
    expect(await release.api.getRelease(admin, rel.id)).toMatchObject({ status: 'building', image: 'registry/jobs:v0.0.1' });
    expect(k8s.applied.filter((object) => object.kind === 'Job' || object.kind === 'Secret')).toEqual([]);
    const name = `build-${rel.id.replaceAll('-', '')}`, build = (await jobRecord(rel.id, 'build'))!;
    expect(build.spec.children.map((child) => `${child.kind}/${child.name}`)).toEqual([`Job/${name}`, `Secret/${name}-env`]);
    expect(build.spec['job']).toMatchObject({ releaseId: rel.id, purpose: 'build', image: 'cs-builder:1', env: { REPO_URL: 'http://gitlab.local/crewstation/jobs.git', REF: 'v0.0.1', IMAGE: 'registry/jobs:v0.0.1' }, resources: { cpu: '250m', memory: '512Mi' }, activeDeadlineSeconds: 600, envSecret: `${name}-env` });
    expect((build.spec['job'] as { command: string[] }).command[2]).toContain('buildctl --addr "tcp://buildkitd:1234"');
    expect(JSON.stringify(build)).not.toContain('token-');
    expect((await release.api.runPipelineStep(rel.id)).done).toBe(false);
    expect(await finish(rel.id, 'build')).toEqual({ GIT_TOKEN: 'token-1' });
    await release.api.runPipelineStep(rel.id);
    expect((await release.api.getRelease(admin, rel.id)).status).toBe('migrating');
    const migration = (await jobRecord(rel.id, 'migration'))!;
    expect(migration.spec['job']).toMatchObject({ purpose: 'migration', image: 'registry/jobs:v0.0.1', command: ['bun', 'run', 'migrate'], env: {}, resources: { cpu: '500m', memory: '512Mi' } });
    // 构建那一步已过：不再给它凭据。
    expect(await release.api.jobEnvValues({ recordId: build.id, releaseId: rel.id, purpose: 'build' }).then(() => 'given', (error: { kind?: string }) => error.kind)).toBe('precondition');
    expect(await finish(rel.id, 'migration')).toMatchObject({ CS_DATABASE_URL: 'postgres://prod', CS_SLOT: 'green' });
    await release.api.runPipelineStep(rel.id);
    expect((await release.api.getRelease(admin, rel.id)).status).toBe('deploying');
  });

  test('Job 失败、没建成、超时：发布判失败（说法与旧的一致）；没建成与超时给 Job 记录报 Failed，调和器据此不再建、删凭据', async () => {
    const failing = await release.api.publish(admin, other, { branch: 'main', version: 'patch' });
    await release.api.runPipelineStep(failing.id);
    await finish(failing.id, 'build', 'failed');
    await release.api.runPipelineStep(failing.id);
    expect(await release.api.getRelease(admin, failing.id)).toMatchObject({ status: 'failed', message: '构建失败：BackoffLimitExceeded' });
    const unbuilt = await release.api.publish(admin, other, { branch: 'main', version: 'patch' });
    await release.api.runPipelineStep(unbuilt.id);
    const record = (await jobRecord(unbuilt.id, 'build'))!;
    await resources.api.observeConditions(record.id, [{ type: 'Created', status: 'false', reason: 'create-failed', message: '构建 Job 没有建成：exceeded quota' }]);
    await release.api.runPipelineStep(unbuilt.id);
    expect(await release.api.getRelease(admin, unbuilt.id)).toMatchObject({ status: 'failed', message: '构建失败：构建 Job 没有建成：exceeded quota' });
    expect((await jobRecord(unbuilt.id, 'build'))?.conditions.find((entry) => entry.type === 'Failed')).toMatchObject({ status: 'true', reason: 'pipeline-failed' });
    const stuck = await release.api.publish(admin, other, { branch: 'main', version: 'patch' });
    await release.api.runPipelineStep(stuck.id);
    nowMs += (600 + 300 + 1) * 1000;
    await release.api.runPipelineStep(stuck.id);
    expect(await release.api.getRelease(admin, stuck.id)).toMatchObject({ status: 'failed', message: '构建超时' });
    expect((await jobRecord(stuck.id, 'build'))?.phase).toBe('failed');
    expect(await release.api.jobEnvValues({ recordId: 'x', releaseId: stuck.id as ReleaseId, purpose: 'build' }).then(() => 'given', (error: { kind?: string }) => error.kind)).toBe('precondition');
  });
});
