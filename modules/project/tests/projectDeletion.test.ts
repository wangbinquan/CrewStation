import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, PROJECT_DELETION_PARTICIPANTS, PROJECT_DELETION_PHASES, ProjectPageQuerySchema } from '@crewstation/contracts';
import type { AcceptProjectDeletion, Actor, ProjectDeletionEvidence, ProjectDeletionInventory, ProjectDeletionPlan, ProjectDto, ProjectId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { jsonHash, newId } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { ProjectDeletionLease } from '../api/deletion';
import type { ProjectModule } from '../wiring';
import { createProjectModule, projectMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let db: TestDatabase, mod: ProjectModule, admin: Actor, secondAdmin: Actor, member: Actor, ordinary: Actor;
let offset = 0, sequence = 0;
const legacyId = newId('legacy') as ProjectId;
const now = () => new Date(Date.now() + offset);
const hosts = { prodHost: (s: string) => `${s}.installed.test`, previewHost: (s: string) => `preview.${s}.installed.test`, serviceHost: (s: string) => `${s}.services.test` };
async function create(state: ProjectDto['state'] = 'provisioning') {
  const project = await mod.api.createProject(admin, { slug: `deletion-${++sequence}`, name: '清理项目', kind: 'DigitalWorker', ownerUserId: member.userId, template: BUILTIN_RESOURCES.minimalTemplate });
  if (state !== 'provisioning') await mod.api.setProjectState(project.id, state === 'archived' ? 'active' : state);
  if (state === 'archived') await mod.api.archiveProject(admin, project.id);
  return project;
}
/** 此文件只验证 project 的意图／租约／清理门禁；其他 owner 的物理回收另有有状态替身与实机用例。 */
async function inventory(id: ProjectId): Promise<ProjectDeletionInventory[]> {
  const own = await mod.api.inspectProjectDeletionMetadata(id);
  return PROJECT_DELETION_PARTICIPANTS.map((participant) => participant === 'project' ? own : { participant, revision: jsonHash(participant), complete: true, resources: [], references: [], blockers: [] });
}
async function prepare(project: ProjectDto) { const reports = await inventory(project.id); return { reports, plan: await mod.api.prepareDeletionPlan(admin, project.id, reports) }; }
const request = (plan: ProjectDeletionPlan): AcceptProjectDeletion => ({ planId: plan.id, requestKey: newId('request'), confirm: 'delete' });
async function start() {
  const project = await create(), { plan, reports } = await prepare(project), input = request(plan);
  const operation = await mod.api.acceptProjectDeletion(admin, project.id, input, reports);
  const claimed = await mod.api.claimProjectDeletion(operation.id, 'worker-a');
  return { project, plan, input, reports, operation, lease: claimed!.lease };
}
const evidence = (value: string): ProjectDeletionEvidence => ({ kind: 'metadata', digest: jsonHash(value), description: `测试 owner 的阶段回执 ${value}`, count: 0 });
async function receipts(lease: ProjectDeletionLease, phases: readonly typeof PROJECT_DELETION_PHASES[number][]) {
  for (const phase of phases) for (const participant of PROJECT_DELETION_PARTICIPANTS) {
    const proof = phase === 'metadata' && participant === 'project' ? await mod.api.purgeProjectDeletionMetadata(lease) : evidence(`${participant}:${phase}`);
    await mod.api.recordProjectDeletionReceipt(lease, participant, phase, proof);
  }
}
beforeAll(async () => {
  if (!available) return;
  db = await createTestDatabase([eventbusMigrations, identityMigrations, { ...projectMigrations, files: projectMigrations.files.filter((f) => !/^001[56]_/.test(f.name)) }]);
  const identity = createIdentityModule({ db: db.db, settings: { adminEmails: [] } });
  const actor = (u: { id: Actor['userId']; isAdmin: boolean }): Actor => ({ userId: u.id, isAdmin: u.isAdmin });
  admin = actor(await identity.api.ensureUser({ externalId: 'admin', name: 'Admin', email: 'admin@test.invalid' }));
  const second = await identity.api.ensureUser({ externalId: 'admin-2', name: 'Admin 2', email: 'admin-2@test.invalid' });
  secondAdmin = actor(await identity.api.setPlatformRole(second.id, { expectedRole: 'user', platformRole: 'admin' }));
  const dev = await identity.api.ensureUser({ externalId: 'member', name: 'Member', email: 'member@test.invalid' });
  member = actor(await identity.api.setPlatformRole(dev.id, { expectedRole: 'user', platformRole: 'developer' }));
  ordinary = actor(await identity.api.ensureUser({ externalId: 'user', name: 'User', email: 'user@test.invalid' }));
  await db.db.execute(sql`INSERT INTO project.projects(id,slug,name,kind,namespace,owner_user_id,state,template,created_by,created_at,updated_at)
    VALUES (${legacyId},'old-deletion','旧项目','DigitalWorker','cs-old-deletion',${member.userId},'failed',${BUILTIN_RESOURCES.minimalTemplate},${admin.userId},now(),now())`);
  await runMigrations(db.db, [projectMigrations]);
  mod = createProjectModule({ db: db.db, identity: identity.api, hosts, clock: { now }, settings: { defaultServicePlan: BUILTIN_RESOURCES.servicePlanSmall, defaultMaxConcurrentTasks: 3 } });
});
afterAll(async () => { await db?.drop(); });

describe.skipIf(!available)('项目永久删除的持久意图与完成屏障（真实 PG）', () => {
  test('旧库升级保留项目身份与状态，新计划使用单调修订并且盘点不改变项目／事件', async () => {
    const old = await mod.api.getProject(admin, legacyId); expect(old).toMatchObject({ slug: 'old-deletion', state: 'failed', ownerUserId: member.userId });
    const before = (await db.db.execute('SELECT count(*) AS n FROM platform_infra.domain_events'))[0];
    const { plan } = await prepare(old);
    expect(plan.target).toMatchObject({ id: legacyId, state: 'failed', revision: '0', prodHost: 'old-deletion.installed.test' });
    expect(plan.participants).toHaveLength(22); expect(plan.complete).toBe(true);
    expect((await mod.api.getProject(admin, legacyId)).state).toBe('failed');
    expect((await db.db.execute('SELECT count(*) AS n FROM platform_infra.domain_events'))[0]).toEqual(before);
  });

  test('管理员资格从实际用户读取；伪造 isAdmin、普通用户和开发者不能盘点、受理、读取或继续', async () => {
    const project = await create(), { plan, reports } = await prepare(project);
    for (const user of [member, ordinary]) {
      const forged = { ...user, isAdmin: true };
      await expect(mod.api.prepareDeletionPlan(forged, project.id, reports)).rejects.toMatchObject({ kind: 'forbidden' });
      await expect(mod.api.acceptProjectDeletion(forged, project.id, request(plan), reports)).rejects.toMatchObject({ kind: 'forbidden' });
      await expect(mod.api.readProjectDeletion(forged, newId('missing'))).rejects.toMatchObject({ kind: 'forbidden' });
      await expect(mod.api.retryProjectDeletion(forged, newId('missing'))).rejects.toMatchObject({ kind: 'forbidden' });
    }
    expect((await mod.api.getProject(admin, project.id)).state).toBe('provisioning');
  });

  test('缺 owner、读取不完整、显式外部阻塞均阻止受理；过期、换项目、资源／同毫秒配置修订变化要求重新确认', async () => {
    const project = await create(), other = await create(), complete = await inventory(project.id);
    for (const reports of [complete.slice(1), complete.map((r) => r.participant === 'data' ? { ...r, complete: false } : r),
      complete.map((r) => r.participant === 'scm' ? { ...r, blockers: [{ participant: 'scm' as const, code: 'shared-reference', message: '其他项目仍引用' }] } : r)]) {
      const plan = await mod.api.prepareDeletionPlan(admin, project.id, reports); expect(plan.complete).toBe(false);
      await expect(mod.api.acceptProjectDeletion(admin, project.id, request(plan), complete)).rejects.toMatchObject({ kind: 'precondition' });
    }
    const { plan, reports } = await prepare(project);
    await expect(mod.api.acceptProjectDeletion(admin, other.id, request(plan), await inventory(other.id))).rejects.toMatchObject({ kind: 'conflict' });
    await expect(mod.api.acceptProjectDeletion(admin, project.id, request(plan), reports.map((r) => r.participant === 'data' ? { ...r, revision: jsonHash('changed') } : r))).rejects.toMatchObject({ kind: 'conflict' });
    offset += 600_001; await expect(mod.api.acceptProjectDeletion(admin, project.id, request(plan), reports)).rejects.toMatchObject({ kind: 'conflict' }); offset = 0;
    const newer = await prepare(project); await mod.api.setQuota(admin, project.id, { maxConcurrentTasks: 4 });
    await expect(mod.api.acceptProjectDeletion(admin, project.id, request(newer.plan), await inventory(project.id))).rejects.toMatchObject({ kind: 'conflict' });
    expect((await mod.api.getProject(admin, project.id)).state).toBe('provisioning');
  });

  test('四种状态均原子受理，不归档；两个管理员并发只有原操作；同键同参重放，异参或其他键冲突', async () => {
    for (const state of ['provisioning', 'active', 'failed', 'archived'] as const) {
      const project = await create(state), { plan, reports } = await prepare(project), input = request(plan);
      const results = await Promise.allSettled([admin, secondAdmin].map((actor) => mod.api.acceptProjectDeletion(actor, project.id, input, reports)));
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      const operation = await mod.api.acceptProjectDeletion(admin, project.id, input, reports);
      expect(results.map((r) => r.status === 'fulfilled' ? r.value.id : '')).toEqual([operation.id, operation.id]);
      expect((await mod.api.getProject(admin, project.id)).state).toBe('deleting');
      expect((await db.db.execute(sql`SELECT id FROM project.deletion_operations WHERE project_id = ${project.id}`))).toHaveLength(1);
      expect((await db.db.execute(sql`SELECT id FROM platform_infra.domain_events WHERE topic = 'project.deletion-requested' AND payload->>'operationId' = ${operation.id}`))).toHaveLength(1);
      await expect(mod.api.acceptProjectDeletion(admin, project.id, { ...input, planId: newId('other') }, reports)).rejects.toMatchObject({ kind: 'conflict' });
      await expect(mod.api.acceptProjectDeletion(admin, project.id, { ...input, requestKey: newId('other') }, reports)).rejects.toMatchObject({ kind: 'conflict', details: { operationId: operation.id } });
    }
  });

  test('发布 outbox 失败整笔受理回滚，没有 deleting 或半笔操作', async () => {
    const project = await create(), { plan, reports } = await prepare(project);
    await db.db.execute(`CREATE FUNCTION platform_infra.reject_project_deletion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.topic = 'project.deletion-requested' THEN RAISE EXCEPTION 'outbox unavailable'; END IF; RETURN NEW; END $$`);
    await db.db.execute('CREATE TRIGGER reject_project_deletion BEFORE INSERT ON platform_infra.domain_events FOR EACH ROW EXECUTE FUNCTION platform_infra.reject_project_deletion()');
    try { await expect(mod.api.acceptProjectDeletion(admin, project.id, request(plan), reports)).rejects.toMatchObject({ cause: { message: 'outbox unavailable' } }); }
    finally { await db.db.execute('DROP TRIGGER reject_project_deletion ON platform_infra.domain_events'); await db.db.execute('DROP FUNCTION platform_infra.reject_project_deletion()'); }
    expect((await mod.api.getProject(admin, project.id)).state).toBe('provisioning');
    expect(await db.db.execute(sql`SELECT id FROM project.deletion_operations WHERE project_id = ${project.id}`)).toHaveLength(0);
  });

  test('删除后旧状态推进、成员／配额／应用写入与直接迟到 SQL 不能复活；开发、开通、市场与网关立即闭准入', async () => {
    const { project } = await start();
    for (const state of ['active', 'failed', 'provisioning'] as const) await expect(mod.api.setProjectState(project.id, state)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(mod.api.setMember(admin, project.id, { userId: ordinary.userId, role: 'tester' })).rejects.toMatchObject({ kind: 'precondition' });
    await expect(mod.api.setQuota(admin, project.id, { maxConcurrentTasks: 8 })).rejects.toMatchObject({ kind: 'precondition' });
    await expect(mod.api.authorize(member, project.id, 'develop')).rejects.toMatchObject({ kind: 'precondition' });
    await expect(Promise.resolve(db.db.execute(sql`UPDATE project.task_quotas SET max_concurrent_tasks = 8 WHERE project_id = ${project.id}`))).rejects.toMatchObject({ cause: { message: 'project is deleting' } });
    await expect(Promise.resolve(db.db.execute(sql`DELETE FROM project.memberships WHERE project_id = ${project.id}`))).rejects.toMatchObject({ cause: { message: 'project is deleting' } });
    const other = await create();
    await expect(Promise.resolve(db.db.execute(sql`UPDATE project.memberships SET project_id = ${other.id} WHERE project_id = ${project.id}`))).rejects.toMatchObject({ cause: { message: 'project is deleting' } });
    expect(await mod.api.getProvisioningProject(project.id)).toBeUndefined();
    expect((await mod.api.listServices()).some((s) => s.projectId === project.id)).toBe(false);
    expect(await mod.api.appAccessBySlug({ id: admin.userId, isAdmin: true }, project.slug)).toEqual({ kind: 'unknown' });
    await expect(mod.api.getMarketListing(admin, project.id)).rejects.toMatchObject({ kind: 'not_found' });
    expect((await mod.api.listProjectPage(admin, ProjectPageQuerySchema.parse({ state: 'deleting' }))).items.some((r) => r.project.id === project.id)).toBe(true);
  });

  test('工作器重启按持久操作补队；有效租约不能重认领，到期接管后旧世代不能写回／延长／阻塞', async () => {
    const { operation, lease } = await start();
    expect(await mod.api.claimProjectDeletion(operation.id, 'worker-b')).toBeUndefined();
    expect(await mod.api.listPendingProjectDeletions()).not.toContain(operation.id);
    offset += 121_000; expect(await mod.api.listPendingProjectDeletions()).toContain(operation.id);
    const next = await mod.api.claimProjectDeletion(operation.id, 'worker-b'); expect(next!.lease.generation).toBe(lease.generation + 1);
    await expect(mod.api.renewProjectDeletion(lease)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(mod.api.recordProjectDeletionReceipt(lease, 'scm', 'seal', evidence('old'))).rejects.toMatchObject({ kind: 'precondition' });
    await expect(mod.api.blockProjectDeletion(lease, [{ participant: 'scm', code: 'old', message: '旧进程' }])).rejects.toMatchObject({ kind: 'precondition' });
    await mod.api.renewProjectDeletion(next!.lease); offset = 0;
  });

  test('seal 和 stop 未齐不能销毁；不可覆盖已完成证明；失败继续保留阶段且旧持有者失效', async () => {
    const { lease, operation } = await start();
    await expect(mod.api.recordProjectDeletionReceipt(lease, 'data', 'purge', evidence('premature'))).rejects.toMatchObject({ kind: 'precondition' });
    await expect(mod.api.completeProjectDeletion(lease)).rejects.toMatchObject({ kind: 'precondition' });
    const proof = evidence('scm:seal'); await mod.api.recordProjectDeletionReceipt(lease, 'scm', 'seal', proof);
    expect((await mod.api.recordProjectDeletionReceipt(lease, 'scm', 'seal', proof)).receipts).toHaveLength(1);
    await expect(mod.api.recordProjectDeletionReceipt(lease, 'scm', 'seal', evidence('replacement'))).rejects.toMatchObject({ kind: 'precondition' });
    const stopped = await mod.api.blockProjectDeletion(lease, [{ participant: 'data', code: 'offline', message: '数据库数据面暂不可用' }]);
    expect(stopped).toMatchObject({ state: 'needs-attention', canRetry: true }); expect(stopped.receipts).toHaveLength(1);
    expect(await mod.api.listPendingProjectDeletions()).not.toContain(operation.id);
    const retry = await mod.api.retryProjectDeletion(secondAdmin, operation.id); expect(retry.receipts).toHaveLength(1);
    const resumed = await mod.api.claimProjectDeletion(operation.id, 'worker-c'); expect(resumed!.lease.generation).toBeGreaterThan(lease.generation);
    await expect(mod.api.renewProjectDeletion(lease)).rejects.toMatchObject({ kind: 'precondition' });
    await mod.api.recordProjectDeletionReceipt(resumed!.lease, 'scm', 'seal', proof);
  });

  test('完整阶段后仍必须清完本模块内容才删根；清理证据和最小结果跨根删除可读，同键重放不重建', async () => {
    const { project, operation, lease, input, reports } = await start(), other = await create();
    await receipts(lease, PROJECT_DELETION_PHASES.slice(0, 5));
    await expect(mod.api.completeProjectDeletion(lease)).rejects.toMatchObject({ kind: 'precondition' });
    await receipts(lease, ['metadata', 'verify']);
    const done = await mod.api.completeProjectDeletion(lease); expect(done).toMatchObject({ state: 'succeeded', canRetry: false });
    expect(await db.db.execute(sql`SELECT id FROM project.projects WHERE id = ${project.id}`)).toHaveLength(0);
    expect(await db.db.execute(sql`SELECT id FROM project.deletion_plans WHERE project_id = ${project.id}`)).toHaveLength(0);
    for (const table of ['services', 'memberships', 'app_listings', 'task_quotas']) expect(await db.db.execute(sql`SELECT project_id FROM ${sql.identifier('project')}.${sql.identifier(table)} WHERE project_id = ${project.id}`)).toHaveLength(0);
    expect((await mod.api.getProject(admin, other.id)).state).toBe('provisioning'); expect(await mod.api.listServicePlans()).not.toHaveLength(0);
    expect(await mod.api.readProjectDeletion(secondAdmin, operation.id)).toEqual(done);
    expect(await mod.api.acceptProjectDeletion(admin, project.id, input, reports)).toEqual(done);
    expect(await mod.api.retryProjectDeletion(admin, operation.id)).toEqual(done); expect(await mod.api.claimProjectDeletion(operation.id, 'late')).toBeUndefined();
  });

  test('新项目内容表未登记会阻断盘点和最终清理，不把来源漂移当作空', async () => {
    const project = await create(); await db.db.execute('CREATE TABLE project.unregistered_content(project_id text, secret text)');
    try { await expect(mod.api.inspectProjectDeletionMetadata(project.id)).rejects.toMatchObject({ kind: 'precondition', details: { tables: ['unregistered_content'] } }); }
    finally { await db.db.execute('DROP TABLE project.unregistered_content'); }
  });
  test('owner 实际许可绑定原目标、盘点、世代和阶段；project 的持久屏障由自身回执证明', async () => {
    const { operation, lease, plan } = await start();
    const context = { operationId: operation.id, generation: lease.generation, target: plan.target, phase: 'seal' as const, confirmed: plan.participants.find((p) => p.participant === 'project')! };
    const result = await mod.api.deletionOwner.run(context); expect(result.kind).toBe('done');
    if (result.kind !== 'done') throw new Error('project seal 没有提供证明');
    await mod.api.recordProjectDeletionReceipt(lease, 'project', 'seal', result.evidence);
    for (const patch of [{ generation: lease.generation + 1 }, { target: { ...plan.target, prodHost: 'another.project.test' } },
      { confirmed: { ...context.confirmed, resources: [] } }, { phase: 'metadata' as const }]) await expect(mod.api.assertProjectDeletionGrant({ ...context, ...patch })).rejects.toMatchObject({ kind: 'precondition' });
    await mod.api.blockProjectDeletion(lease, [{ participant: 'project', code: 'test-pause', message: '测试暂停' }]);
    await expect(mod.api.deletionOwner.run(context)).rejects.toMatchObject({ kind: 'precondition' });
  });
});
