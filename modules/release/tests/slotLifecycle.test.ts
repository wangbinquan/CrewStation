import { afterEach, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, ReleaseDto, ServiceId, SlotDto, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import type { K8sClient } from '@crewstation/k8s';
import { createFakeK8sClient, LABELS, Resources } from '@crewstation/k8s';
import { forbidden } from '@crewstation/kernel';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { TestDatabase } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { withSlot } from '../domain/slots';
import { createReleaseModule, releaseMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let database: TestDatabase | undefined;
afterEach(async () => { await database?.drop(); database = undefined; });

const H = 3_600_000, D = 24 * H;
const owner: Actor = { userId: '01a0bf5d-8f4b-7210-80c1-302ae945a901' as UserId, isAdmin: false };
const developer: Actor = { userId: '01a0bf5d-8f4b-7210-80c1-302ae945a902' as UserId, isAdmin: false };
const admin: Actor = { userId: '01a0bf5d-8f4b-7210-80c1-302ae945a903' as UserId, isAdmin: true };
const serviceId = '01a0bf5d-8f4b-7aea-8983-7b41e8b30564' as ServiceId, projectId = '01a0bf5d-8f4b-7710-89f8-83b88c835ea7' as ProjectId;
const ns = 'cs-lifecycle';
const manifest = (migration = '{ compatibility: none, destructive: false, rollback: switch-back }') =>
  `apiVersion: crewstation/v2\nkind: DigitalWorker\nspec:\n  service: { command: [bun], port: 3000, healthPath: /healthz, servicePlanId: 01a0bf5d-8f4b-781d-8b8e-bbbbc69c6c6a, replicas: 1 }\n  release:\n    migration: ${migration}\n`;

async function fixture() {
  database = await createTestDatabase([eventbusMigrations, queueMigrations, releaseMigrations]);
  const state = { now: new Date('2026-09-23T00:00:00.000Z'), yaml: manifest() as string | undefined, window: false, version: 0, rejectDryRun: undefined as string | undefined, rejectDeploy: undefined as string | undefined, planGone: false, manifestRefs: [] as string[] };
  // API Server 的拒绝：dry-run（统一预检）与真正部署各自可以设一个原因，只针对 Deployment。
  const fake = createFakeK8sClient();
  const apply = (async (obj, options) => {
    const refusal = obj.kind === 'Deployment' ? (options?.dryRun ? state.rejectDryRun : state.rejectDeploy) : undefined;
    if (refusal) throw new Error(refusal);
    return fake.apply(obj, options);
  }) as K8sClient['apply'];
  const k8s = { ...fake, apply };
  const notices: Array<{ users: UserId[]; message: string }> = [];
  const release = createReleaseModule({
    db: database.db, k8s, isAdmin: async (id) => id === admin.userId, clock: { now: () => new Date(state.now) },
    // 负责人与管理员可以下线、推迟、重新部署、切流；开发者可以发布与查看（与 project 模块的角色表一致）。
    authorizer: { authorize: async (actor, _p, action) => { if ((action === 'manage-slots' || action === 'switch-traffic') && actor.userId !== owner.userId && !actor.isAdmin) throw forbidden(`角色 developer 不能执行 ${action}`); } },
    tagger: { createReleaseTag: async () => ({ tag: `v0.0.${++state.version}`, commitSha: `${state.version}`.padStart(40, 'a') }) },
    repo: { readFile: async (_s, ref, path) => { if (path !== 'crewstation.yaml') return undefined; state.manifestRefs.push(ref); return state.yaml; }, repositoryUrl: async () => ({ httpUrl: 'https://repo.invalid/lifecycle', credentialSecretName: 'lifecycle-git' }) },
    services: { resolveServiceById: async () => ({ projectId, slug: 'lifecycle', name: 'lifecycle', namespace: ns }) },
    plans: { getServicePlan: async () => (state.planGone ? undefined : { id: '01a0bf5d-8f4b-781d-8b8e-bbbbc69c6c6a', name: 'small', cpu: '1', memory: '1Gi', maxReplicas: 3, description: '' }), lookupComputeProfile: async () => undefined, listComputeProfiles: async () => [] },
    config: { render: async () => ({ values: {}, version: 3 }), validate: async () => ({ missing: [] }) }, data: { envFor: async () => ({}) },
    hosts: { prodHost: () => 'lifecycle.cs.localhost', previewHost: () => 'preview.lifecycle.cs.localhost' },
    maintenance: { open: async () => state.window },
    owners: { ownerOf: async () => owner.userId },
    notifier: { notify: async (_p, users, message) => { notices.push({ users, message }); } },
    settings: { registryBase: 'registry', buildTimeoutSeconds: 10, deployTimeoutSeconds: 600, builderImage: 'builder', buildkitAddress: 'buildkit', workerOwner: 'lifecycle-test', serviceDomain: 'svc.internal', userDomain: 'cs.localhost' },
  });
  const uow = drizzleUnitOfWork(database.db);
  const standby = async () => (await release.api.slotRoles(serviceId))?.preview ?? 'green';
  const deployment = async (physical: string) => k8s.get(Resources.Deployment!, `lifecycle-${physical}`, ns);
  const markReady = async (physical: string) => k8s.mergePatch(Resources.Deployment!, `lifecycle-${physical}`, ns, { status: { replicas: 1, readyReplicas: 1 } });
  const publish = async (): Promise<ReleaseDto> => {
    const physical = await standby();
    const rel = await release.api.publish(owner, serviceId, { branch: 'main', version: 'patch' });
    await release.api.runPipelineStep(rel.id);
    await k8s.mergePatch(Resources.Job!, `build-${rel.id.replaceAll('-', '')}`, ns, { status: { succeeded: 1 } });
    await release.api.runPipelineStep(rel.id);
    await markReady(physical);
    await release.api.runPipelineStep(rel.id);
    return release.api.getRelease(owner, rel.id);
  };
  const goLive = async (target: ReleaseDto) => {
    const prod = (await release.api.getSlots(owner, serviceId)).find((s) => s.name === 'prod');
    return release.api.switchTraffic(owner, serviceId, { toSlot: 'preview', expectedActiveRelease: prod?.releaseId ?? null, expectedTargetRelease: target.id });
  };
  const preview = async (): Promise<SlotDto> => (await release.api.getSlots(owner, serviceId)).find((s) => s.name === 'preview')!;
  const jobs = async () => (await k8s.list(Resources.Job!, ns)).length;
  return { release, k8s, state, notices, uow, standby, deployment, markReady, publish, goLive, preview, jobs, at: (ms: number) => { state.now = new Date(Date.parse('2026-09-23T00:00:00.000Z') + ms); } };
}

describe.skipIf(!available)('RFC-021 待命槽生命周期', () => {
  test('切流后原正式版本成为回退目标：72 小时到期，提前 24 小时提醒负责人；提醒之后才能推迟，推迟不限次数；到期后平台自动下线', async () => {
    const f = await fixture();
    const v1 = await f.publish(); await f.goLive(v1);
    const v2 = await f.publish(); f.at(H); await f.goLive(v2);
    expect((await f.preview()).retention).toEqual({ kind: 'rollback-target', since: new Date(Date.parse('2026-09-23T00:00:00.000Z') + H).toISOString(), deadline: new Date(Date.parse('2026-09-23T00:00:00.000Z') + 73 * H).toISOString(), postponable: false, postponements: 0, periodHours: 72 });
    f.at(48 * H); expect((await f.release.api.sweepSlotLifecycle()).reminded).toBe(0);
    // 2026-09-23 裁定：提醒发出之前不能推迟，确认值再对也不行。
    await expect(f.release.api.postponeOffline(owner, serviceId, { expectedDeadline: (await f.preview()).retention!.deadline })).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('提醒负责人之后才能推迟') });
    f.at(49 * H); expect((await f.release.api.sweepSlotLifecycle()).reminded).toBe(1);
    expect(f.notices.at(-1)).toMatchObject({ users: [owner.userId], message: expect.stringContaining(v1.tag) });
    expect((await f.release.api.listSlotEvents(owner, serviceId))[0]).toMatchObject({ kind: 'reminder', releaseId: v1.id, deadline: (await f.preview()).retention!.deadline });
    expect((await f.preview()).retention).toMatchObject({ remindedAt: expect.any(String), postponable: true });
    // 过期的确认值（页面停留期间别人已推迟过）被拒，不会一次推迟两个周期。
    await expect(f.release.api.postponeOffline(owner, serviceId, { expectedDeadline: '2026-09-30T00:00:00.000Z' })).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.release.api.postponeOffline(developer, serviceId, { expectedDeadline: (await f.preview()).retention!.deadline })).rejects.toMatchObject({ kind: 'forbidden' });
    const once = (await f.release.api.postponeOffline(owner, serviceId, { expectedDeadline: (await f.preview()).retention!.deadline })).find((s) => s.name === 'preview')!;
    expect(once.retention).toMatchObject({ deadline: new Date(Date.parse('2026-09-23T00:00:00.000Z') + 145 * H).toISOString(), postponable: false, postponements: 1 });
    expect(once.retention?.remindedAt).toBeUndefined();
    // 推迟一次之后接着再点（确认值是新的）也被拒：要等新到期时间的提醒。
    await expect(f.release.api.postponeOffline(admin, serviceId, { expectedDeadline: once.retention!.deadline })).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('提醒负责人之后才能推迟') });
    f.at(121 * H); expect((await f.release.api.sweepSlotLifecycle()).reminded).toBe(1);
    const twice = (await f.release.api.postponeOffline(admin, serviceId, { expectedDeadline: once.retention!.deadline })).find((s) => s.name === 'preview')!;
    expect(twice.retention).toMatchObject({ deadline: new Date(Date.parse('2026-09-23T00:00:00.000Z') + 217 * H).toISOString(), postponable: false, postponements: 2 });
    f.at(193 * H); expect((await f.release.api.sweepSlotLifecycle()).reminded).toBe(1);
    f.at(216 * H); expect((await f.release.api.sweepSlotLifecycle()).offline).toBe(0);
    f.at(217 * H); expect((await f.release.api.sweepSlotLifecycle()).offline).toBe(1);
    expect((await f.preview()).offline).toMatchObject({ releaseId: v1.id, tag: v1.tag, reason: 'rollback-expired' });
    expect((await f.preview()).offline?.actorUserId).toBeUndefined();
    expect(await f.deployment('green')).toBeUndefined();
    expect(await f.k8s.get(Resources.Service!, 'lifecycle-green', ns)).toBeDefined();
    expect(await f.release.api.getRelease(owner, v1.id)).toMatchObject({ status: 'offline', redeployable: true });
  });

  // 2026-09-23 实机：RFC-013 之前部署的 Deployment 标签上是旧 `rel_…` ID，只认 UUID 时下线会把它当成别的版本留着不删（本机 8 个待命槽全是这样）。
  test('RFC-013 之前部署的待命槽：Deployment 标签是旧 ID 时下线照样删掉；标签属于别的版本时不删', async () => {
    const f = await fixture();
    const v1 = await f.publish(), physical = await f.standby();
    await database!.db.execute(sql`UPDATE release.releases SET legacy_resource_id = 'rel_legacy_v1' WHERE id = ${v1.id}`);
    await f.k8s.mergePatch(Resources.Deployment!, `lifecycle-${physical}`, ns, { metadata: { labels: { [LABELS.release]: 'rel_legacy_v1' } } });
    await f.release.api.takeOffline(owner, serviceId, { expectedReleaseId: v1.id });
    expect(await f.deployment(physical)).toBeUndefined();

    await f.release.api.redeploy(owner, v1.id, { expectedStandbyReleaseId: null });
    await f.markReady(physical); await f.release.api.runPipelineStep(v1.id);
    await f.k8s.mergePatch(Resources.Deployment!, `lifecycle-${physical}`, ns, { metadata: { labels: { [LABELS.release]: 'rel_someone_else' } } });
    await f.release.api.takeOffline(owner, serviceId, { expectedReleaseId: v1.id });
    expect((await f.deployment(physical))?.metadata.labels?.[LABELS.release]).toBe('rel_someone_else');
  });

  // 2026-09-23 实机：demo 的 v0.1.2 发于 RFC-001 之前，发布记录里的 Manifest 还写着 driver／model，重新部署在预检里读 compute 时 500。
  // 作者裁定：这类版本照常列出，确认时预检拒绝并写明原因。
  test('发布记录里是平台已不接受的旧写法：照常可选，确认时预检 412 并写明原因与出路，槽与记录都不变', async () => {
    const f = await fixture();
    const v1 = await f.publish(), physical = await f.standby();
    await f.release.api.takeOffline(owner, serviceId, { expectedReleaseId: v1.id });
    const legacy = { id: '01a0bf5d-8f4b-7c2a-9d1e-5a4b3c2d1e0f', name: 'chat-v1', driver: 'stub', model: 'stub/echo', permission: 'read-only' };
    const tasks = { taskProfileId: '01a0bf5d-8f4b-7c2a-9d1e-5a4b3c2d1e10', defaultVolumeMode: 'follow-container', agentProfiles: [legacy], outputContracts: [] };
    await database!.db.execute(sql`UPDATE release.releases SET manifest = jsonb_set(manifest, '{spec,tasks}', ${JSON.stringify(tasks)}::jsonb) WHERE id = ${v1.id}`);
    expect(await f.release.api.getRelease(owner, v1.id)).toMatchObject({ status: 'offline', redeployable: true });
    await expect(f.release.api.redeploy(owner, v1.id, { expectedStandbyReleaseId: null })).rejects.toMatchObject({
      kind: 'precondition', message: expect.stringMatching(new RegExp(`^${v1.tag} 的 Manifest 不符合当前平台的写法，不能部署：.*driver.*compute: \\{ kind: default \\}.*请改好仓库里的 crewstation\\.yaml 后发布新版本$`, 's')),
      details: { code: 'manifest-outdated', hint: '发布记录里的 Manifest 随标签固定，请改好仓库里的 crewstation.yaml 后发布新版本' },
    });
    // RFC-025 统一预检：弹窗选中它时先问一次，同样的原因码与出路，不写任何东西。
    expect(await f.release.api.redeployPrecheck(owner, v1.id)).toMatchObject({ ok: false, reason: { code: 'manifest-outdated', hint: expect.stringContaining('发布新版本') } });
    expect(await f.deployment(physical)).toBeUndefined();
    expect(await f.release.api.getRelease(owner, v1.id)).toMatchObject({ status: 'offline', redeployable: true });
    expect(await f.preview()).toMatchObject({ state: 'empty', offline: { releaseId: v1.id } });
    expect((await f.release.api.listSlotEvents(owner, serviceId))[0]).toMatchObject({ kind: 'offline' });
  });

  test('统一预检（RFC-025）：重新部署先问一次——能部署时通过；集群 dry-run 拒绝、有发布在进行各给原因码与出路；确认时同样 412，槽与发布都不变', async () => {
    const f = await fixture();
    const v1 = await f.publish(), physical = await f.standby();
    await f.release.api.takeOffline(owner, serviceId, { expectedReleaseId: v1.id });
    expect(await f.release.api.redeployPrecheck(owner, v1.id)).toEqual({ ok: true });
    await expect(f.release.api.redeployPrecheck(developer, v1.id)).rejects.toMatchObject({ kind: 'forbidden' });
    f.state.rejectDryRun = 'admission webhook "quota.example" denied the request: exceeded quota: cpu';
    expect(await f.release.api.redeployPrecheck(owner, v1.id)).toEqual({ ok: false, reason: {
      code: 'cluster-rejected', message: '集群拒绝了这次部署：admission webhook "quota.example" denied the request: exceeded quota: cpu', hint: '检查套餐的资源规格与项目命名空间的配额，或联系管理员',
    } });
    await expect(f.release.api.redeploy(owner, v1.id, { expectedStandbyReleaseId: null })).rejects.toMatchObject({ kind: 'precondition', details: { code: 'cluster-rejected' } });
    expect(await f.deployment(physical)).toBeUndefined();
    expect(await f.release.api.getRelease(owner, v1.id)).toMatchObject({ status: 'offline', redeployable: true });
    expect(await f.preview()).toMatchObject({ state: 'empty', offline: { releaseId: v1.id } });
    f.state.rejectDryRun = undefined;
    const pending = await f.release.api.publish(owner, serviceId, { branch: 'main', version: 'patch' });
    expect(await f.release.api.redeployPrecheck(owner, v1.id)).toMatchObject({ ok: false, reason: { code: 'release-in-progress', message: `发布 ${pending.tag} 仍在进行中（pending）`, hint: '请等待结束后再操作' } });
    await expect(f.release.api.redeploy(owner, v1.id, { expectedStandbyReleaseId: null })).rejects.toMatchObject({ kind: 'precondition', details: { code: 'release-in-progress', releaseId: pending.id } });
  });

  test('统一预检：套餐被收回（不存在或不再对本项目开放）时重新部署给 plan-unavailable 与出路，槽不变', async () => {
    const f = await fixture();
    const v1 = await f.publish();
    await f.release.api.takeOffline(owner, serviceId, { expectedReleaseId: v1.id });
    f.state.planGone = true;
    expect(await f.release.api.redeployPrecheck(owner, v1.id)).toEqual({ ok: false, reason: {
      code: 'plan-unavailable', message: '服务套餐 01a0bf5d-8f4b-781d-8b8e-bbbbc69c6c6a 不存在或已不对本项目开放', hint: '请管理员恢复套餐或把它开放给本项目，或在 crewstation.yaml 里换一个可用的套餐后发布新版本',
    } });
    await expect(f.release.api.redeploy(owner, v1.id, { expectedStandbyReleaseId: null })).rejects.toMatchObject({ kind: 'precondition', details: { code: 'plan-unavailable' } });
    expect(await f.preview()).toMatchObject({ state: 'empty', offline: { releaseId: v1.id } });
  });

  test('统一预检：发布受理时按要打标签的那次提交读 Manifest——不在、不是合法 YAML、写法不对都 412，不打标签、不登记发布', async () => {
    const f = await fixture();
    const sha = 'c'.repeat(40);
    f.state.yaml = undefined;
    await expect(f.release.api.publish(owner, serviceId, { branch: 'main', expectedCommitSha: sha, version: 'patch' })).rejects.toMatchObject({
      kind: 'precondition', message: `main 的提交 cccccccc 上没有 crewstation.yaml。在仓库根目录提交 crewstation.yaml 后再发布`, details: { code: 'manifest-missing' },
    });
    expect(f.state.manifestRefs).toEqual([sha]);
    f.state.yaml = 'spec: [unclosed';
    await expect(f.release.api.publish(owner, serviceId, { branch: 'main', version: 'patch' })).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('分支 main 上的 crewstation.yaml 不是合法的 YAML'), details: { code: 'manifest-invalid' } });
    expect(f.state.manifestRefs.at(-1)).toBe('main');
    f.state.yaml = 'apiVersion: crewstation/v2\nkind: DigitalWorker\nspec: {}\n';
    await expect(f.release.api.publish(owner, serviceId, { branch: 'main', version: 'patch' })).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('分支 main 上的 crewstation.yaml 无效'), details: { code: 'manifest-invalid', hint: '改好仓库里的 crewstation.yaml 并提交后再发布' } });
    expect(f.state.version).toBe(0);
    expect(await f.release.api.listReleases(owner, serviceId)).toEqual([]);
    f.state.yaml = manifest();
    expect((await f.publish()).status).toBe('ready');
  });

  test('受理之后的部署失败记进发布记录：返回失败的发布，不抛 500；待验证槽记为失败', async () => {
    const f = await fixture();
    const v1 = await f.publish();
    await f.release.api.takeOffline(owner, serviceId, { expectedReleaseId: v1.id });
    f.state.rejectDeploy = 'connection reset by peer';
    const failed = await f.release.api.redeploy(owner, v1.id, { expectedStandbyReleaseId: null });
    expect(failed).toMatchObject({ id: v1.id, status: 'failed', message: '重新部署失败：connection reset by peer。看发布记录与槽的日志，处理后重新部署' });
    expect(await f.preview()).toMatchObject({ state: 'failed', releaseId: v1.id });
  });

  test('待验证版本连续 14 天无人访问才下线：访问 preview 推后到期，5 分钟内的重复访问只记一次', async () => {
    const f = await fixture();
    await f.publish();
    const start = Date.parse('2026-09-23T00:00:00.000Z');
    expect((await f.preview()).retention).toMatchObject({ kind: 'pending', deadline: new Date(start + 14 * D).toISOString(), periodHours: 336 });
    f.at(3 * D); await f.release.api.notePreviewAccess(serviceId);
    expect((await f.preview()).retention?.deadline).toBe(new Date(start + 17 * D).toISOString());
    f.at(3 * D + 60_000); await f.release.api.notePreviewAccess(serviceId);
    expect((await f.preview()).retention?.deadline).toBe(new Date(start + 17 * D).toISOString());
    f.at(3 * D + 6 * 60_000); await f.release.api.notePreviewAccess(serviceId);
    const deadline = start + 17 * D + 6 * 60_000;
    expect((await f.preview()).retention?.deadline).toBe(new Date(deadline).toISOString());
    f.state.now = new Date(deadline - D); expect((await f.release.api.sweepSlotLifecycle()).reminded).toBe(1);
    f.state.now = new Date(deadline); expect((await f.release.api.sweepSlotLifecycle()).offline).toBe(1);
    expect((await f.preview()).offline?.reason).toBe('idle');
  });

  test('升级前就在跑的待命槽从升级后第一次巡检开始计时，不会在升级后立刻被下线（M26）', async () => {
    const f = await fixture();
    await f.publish();
    // 模拟升级前的数据：待命槽有版本、没有计时。
    await f.uow.run(async (scope) => { const slots = (await scope.slots.get(serviceId))!; const { retention: _r, ...slot } = slots.green; await scope.slots.save(withSlot(slots, slot, slots.updatedAt)); });
    f.at(60 * D);
    expect(await f.release.api.sweepSlotLifecycle()).toEqual({ initialized: 1, reminded: 0, offline: 0, repaired: 0 });
    expect((await f.preview()).retention).toMatchObject({ kind: 'pending', since: new Date(Date.parse('2026-09-23T00:00:00.000Z') + 60 * D).toISOString() });
    expect((await f.release.api.sweepSlotLifecycle()).offline).toBe(0);
  });

  test('负责人下线待验证版本：删工作负载、留 Service，发布转已下线；从发布记录重新部署不构建、不迁移，就绪后重新计时', async () => {
    const f = await fixture();
    const v1 = await f.publish();
    await expect(f.release.api.takeOffline(developer, serviceId, { expectedReleaseId: v1.id })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.release.api.takeOffline(owner, serviceId, { expectedReleaseId: serviceId as unknown as ReleaseDto['id'] })).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('已变化') });
    const slots = await f.release.api.takeOffline(owner, serviceId, { expectedReleaseId: v1.id });
    expect(slots.find((s) => s.name === 'preview')).toMatchObject({ state: 'empty', replicas: 0, offline: { releaseId: v1.id, tag: v1.tag, reason: 'manual', actorUserId: owner.userId } });
    expect(slots.find((s) => s.name === 'preview')?.releaseId).toBeUndefined();
    expect(await f.deployment('green')).toBeUndefined();
    expect(await f.k8s.get(Resources.Service!, 'lifecycle-green', ns)).toBeDefined();
    expect(await f.release.api.getRelease(owner, v1.id)).toMatchObject({ status: 'offline', redeployable: true });
    expect((await f.release.api.listSlotEvents(owner, serviceId))[0]).toMatchObject({ kind: 'offline', reason: 'manual', actorUserId: owner.userId, tag: v1.tag });
    await expect(f.release.api.takeOffline(owner, serviceId, { expectedReleaseId: v1.id })).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('没有运行中的版本') });

    const jobs = await f.jobs();
    await expect(f.release.api.redeploy(owner, v1.id, { expectedStandbyReleaseId: v1.id })).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('待验证槽已变化') });
    await expect(f.release.api.redeploy(developer, v1.id, { expectedStandbyReleaseId: null })).rejects.toMatchObject({ kind: 'forbidden' });
    const started = await f.release.api.redeploy(owner, v1.id, { expectedStandbyReleaseId: null });
    expect(started).toMatchObject({ id: v1.id, status: 'deploying', configVersion: 3, redeployable: false });
    expect((await f.deployment('green'))?.metadata.labels?.[LABELS.release]).toBe(v1.id);
    await f.markReady('green'); await f.release.api.runPipelineStep(v1.id);
    expect(await f.release.api.getRelease(owner, v1.id)).toMatchObject({ status: 'ready', redeployable: false });
    expect(await f.jobs()).toBe(jobs);
    expect(await f.preview()).toMatchObject({ state: 'ready', releaseId: v1.id, retention: { kind: 'pending', postponements: 0 } });
    expect((await f.release.api.listSlotEvents(owner, serviceId))[0]).toMatchObject({ kind: 'redeploy', releaseId: v1.id, actorUserId: owner.userId });
    await expect(f.release.api.redeploy(owner, v1.id, { expectedStandbyReleaseId: v1.id })).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('不能重新部署') });
    await f.goLive(v1);
    await expect(f.release.api.redeploy(owner, v1.id, { expectedStandbyReleaseId: null })).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('就是当前正式版本') });
  });

  test('重新部署与回退同一条兼容规则：当前正式版本禁止回退时不能重新部署更早的版本；进行中的发布期间拒绝下线与重新部署', async () => {
    const f = await fixture();
    const v1 = await f.publish(); await f.goLive(v1);
    f.state.yaml = manifest('{ compatibility: none, destructive: false, rollback: blocked }');
    f.at(H); const v2 = await f.publish(); await f.goLive(v2);
    await f.release.api.takeOffline(admin, serviceId, { expectedReleaseId: v1.id });
    await expect(f.release.api.redeploy(owner, v1.id, { expectedStandbyReleaseId: null })).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('不能重新部署更早的版本') });
    f.state.yaml = manifest();
    const v3 = await f.release.api.publish(owner, serviceId, { branch: 'main', version: 'patch' });
    await expect(f.release.api.redeploy(admin, v1.id, { expectedStandbyReleaseId: null })).rejects.toMatchObject({ kind: 'precondition' });
    await f.release.api.runPipelineStep(v3.id);
    await f.k8s.mergePatch(Resources.Job!, `build-${v3.id.replaceAll('-', '')}`, ns, { status: { succeeded: 1 } });
    await f.release.api.runPipelineStep(v3.id);
    await expect(f.release.api.takeOffline(owner, serviceId, { expectedReleaseId: v3.id })).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('仍在进行中') });
    // 巡检遇到进行中的发布也不动这个槽。
    f.at(90 * D); expect((await f.release.api.sweepSlotLifecycle()).offline).toBe(0);
  });

  test('含破坏性迁移：不在完整维护中时部署与切流都被拒；完整维护中可以部署、可以切流（M17、M27）', async () => {
    const f = await fixture();
    const v1 = await f.publish(); await f.goLive(v1);
    f.state.yaml = manifest('{ compatibility: destructive, destructive: true, rollback: blocked }');
    // RFC-025 统一预检：不在维护窗口里时发布受理时就拒绝，不打标签、不登记发布。
    await expect(f.release.api.publish(owner, serviceId, { branch: 'main', version: 'minor' })).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('只能在项目维护期间发布'), details: { code: 'maintenance-window-required' } });
    expect(await f.release.api.listReleases(owner, serviceId)).toHaveLength(1);
    f.state.window = true;
    const v2 = await f.publish();
    expect(v2.status).toBe('ready');
    f.state.window = false;
    await expect(f.goLive(v2)).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('只能在项目维护期间上线') });
    f.state.window = true;
    expect((await f.goLive(v2)).releaseId).toBe(v2.id);
  });

  test('平台设置：管理员读写三个时长，带版本号；提醒必须短于两个周期；改完立刻作用于到期时间；非管理员 403', async () => {
    const f = await fixture();
    await f.publish();
    expect(await f.release.api.getAutoOfflinePolicy(admin)).toEqual({ rollbackRetentionHours: 72, idleOfflineDays: 14, reminderLeadHours: 24, revision: 0, updatedAt: null });
    await expect(f.release.api.getAutoOfflinePolicy(owner)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.release.api.setAutoOfflinePolicy(admin, { rollbackRetentionHours: 48, idleOfflineDays: 7, reminderLeadHours: 12, expectedRevision: 1 })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.release.api.setAutoOfflinePolicy(admin, { rollbackRetentionHours: 12, idleOfflineDays: 7, reminderLeadHours: 12, expectedRevision: 0 })).rejects.toMatchObject({ kind: 'validation' });
    const saved = await f.release.api.setAutoOfflinePolicy(admin, { rollbackRetentionHours: 48, idleOfflineDays: 7, reminderLeadHours: 12, expectedRevision: 0 });
    expect(saved).toMatchObject({ rollbackRetentionHours: 48, idleOfflineDays: 7, reminderLeadHours: 12, revision: 1, updatedBy: admin.userId });
    expect((await f.preview()).retention).toMatchObject({ deadline: new Date(Date.parse('2026-09-23T00:00:00.000Z') + 7 * D).toISOString(), periodHours: 168 });
    await expect(f.release.api.setAutoOfflinePolicy(admin, { rollbackRetentionHours: 48, idleOfflineDays: 7, reminderLeadHours: 12, expectedRevision: 0 })).rejects.toMatchObject({ kind: 'conflict' });
  });

  test('HTTP：未登录 401、多余字段 400、开发者 403；下线、推迟、记录、重新部署、平台设置的成功路径', async () => {
    const f = await fixture();
    const v1 = await f.publish();
    const app = createApp({ name: 'release-lifecycle-test' }); for (const r of f.release.http) app.route('/', r);
    const as = (actor: Actor) => ({ [IDENTITY_HEADERS.userId]: actor.userId, [IDENTITY_HEADERS.userName]: 'n', [IDENTITY_HEADERS.userEmail]: 'e@x', 'content-type': 'application/json' });
    const post = (path: string, actor: Actor | undefined, body: unknown) => app.request(path, { method: 'POST', headers: actor ? as(actor) : { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const base = `/v1/services/${serviceId}`;
    expect((await post(`${base}/slots/preview/offline`, undefined, { expectedReleaseId: v1.id })).status).toBe(401);
    expect((await post(`${base}/slots/preview/offline`, owner, { expectedReleaseId: v1.id, force: true })).status).toBe(400);
    expect((await post(`${base}/slots/preview/offline`, developer, { expectedReleaseId: v1.id })).status).toBe(403);
    const deadline = (await f.preview()).retention!.deadline;
    // 提醒发出之前推迟被拒（412，带原因）；提醒之后同一个请求成功。
    const early = await post(`${base}/slots/preview/postpone`, owner, { expectedDeadline: deadline });
    expect(early.status).toBe(412);
    expect(await early.json()).toMatchObject({ error: 'precondition', message: expect.stringContaining('提醒负责人之后才能推迟') });
    f.at(13 * D); expect((await f.release.api.sweepSlotLifecycle()).reminded).toBe(1);
    f.at(13 * D + H);
    const postponed = await post(`${base}/slots/preview/postpone`, owner, { expectedDeadline: deadline });
    expect(postponed.status).toBe(200);
    expect(((await postponed.json()) as { items: SlotDto[] }).items.find((s) => s.name === 'preview')?.retention).toMatchObject({ postponable: false, postponements: 1 });
    f.at(13 * D + 2 * H);
    const offline = await post(`${base}/slots/preview/offline`, owner, { expectedReleaseId: v1.id });
    expect(offline.status).toBe(200);
    expect(((await offline.json()) as { items: SlotDto[] }).items.find((s) => s.name === 'preview')?.offline?.reason).toBe('manual');
    const events = await app.request(`${base}/slot-events`, { headers: as(developer) });
    expect(events.status).toBe(200);
    expect(((await events.json()) as { items: Array<{ kind: string }> }).items.map((e) => e.kind)).toEqual(['offline', 'postpone', 'reminder']);
    // 统一预检的只读查询：负责人拿到结果，开发者 403。
    const precheck = await app.request(`/v1/releases/${v1.id}/redeploy-precheck`, { headers: as(owner) });
    expect(precheck.status).toBe(200);
    expect(await precheck.json()).toEqual({ ok: true });
    expect((await app.request(`/v1/releases/${v1.id}/redeploy-precheck`, { headers: as(developer) })).status).toBe(403);
    const redeploy = await post(`/v1/releases/${v1.id}/redeploy`, owner, { expectedStandbyReleaseId: null });
    expect(redeploy.status).toBe(202);
    expect(((await redeploy.json()) as ReleaseDto).status).toBe('deploying');
    expect((await app.request('/v1/admin/settings/auto-offline', { headers: as(owner) })).status).toBe(403);
    const put = await app.request('/v1/admin/settings/auto-offline', { method: 'PUT', headers: as(admin), body: JSON.stringify({ rollbackRetentionHours: 96, idleOfflineDays: 21, reminderLeadHours: 24, expectedRevision: 0 }) });
    expect(put.status).toBe(200);
    expect(await (await app.request('/v1/admin/settings/auto-offline', { headers: as(admin) })).json()).toMatchObject({ rollbackRetentionHours: 96, idleOfflineDays: 21, revision: 1 });
    expect((await app.request('/v1/admin/settings/auto-offline', { method: 'PUT', headers: as(admin), body: JSON.stringify({ rollbackRetentionHours: 24, idleOfflineDays: 1, reminderLeadHours: 24, expectedRevision: 1 }) })).status).toBe(400);
  });
});
