import { describe, expect, test } from 'bun:test';
import { CreateComputeProfileRequestSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { computeDeletionRepository } from '../adapters/persistence/deletionRepository';
import { computeDeletionFixture } from './deletionFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('算力项目分配完整删除与原标识屏障', () => {
  test('升级历史、完整确认与最后删根；只清本项目策略和1205回执，共享目录及外部原文保持', async () => {
    const f = await computeDeletionFixture(1205);
    try {
      const credentialId = newResourceId();
      const detail = await f.compute.api.createProfile(f.admin, CreateComputeProfileRequestSchema.parse({ name: 'retained-profile', content: { image: 'runtime/agent:v1', launch: { protocol: 'opencode', binaryPath: '/opt/agent' }, secrets: [{ id: credentialId, name: 'TOKEN' }] }, credentials: { [credentialId]: { op: 'replace', value: 'fixture-shared-credential' } } }));
      const ref = { profileId: detail.id, revision: detail.revision }, stamp = await f.compute.api.pinLaunchVersion(ref);
      const before = await f.database.db.execute(sql`SELECT (SELECT jsonb_agg(to_jsonb(p)) FROM agent_runtime.profiles AS p) AS profiles,(SELECT jsonb_agg(to_jsonb(r)) FROM agent_runtime.profile_revisions AS r) AS revisions,(SELECT jsonb_agg(to_jsonb(t)) FROM agent_runtime.profile_tests AS t) AS tests,(SELECT jsonb_agg(to_jsonb(c)) FROM agent_runtime.profile_credentials AS c) AS credentials,(SELECT jsonb_agg(to_jsonb(v)) FROM agent_runtime.credential_versions AS v) AS versions`);
      const target = await f.project.api.deletionScope(f.own.id), report = await f.compute.api.deletionOwner!.inspect(target);
      expect(report.complete).toBe(true); expect(report.resources.map((r) => [r.kind, r.count])).toEqual([['project_compute_policies', 1], ['allocation_receipts', 1205]]);
      expect(JSON.stringify(report)).not.toContain('erase-allocation');
      const started = await f.begin(), fresh = f.application();
      for (const application of [f.compute, fresh]) {
        await expect(application.api.saveProjectComputePolicy(f.admin, f.own.id, { expectedRevision: 1, policy: f.policy })).rejects.toBeDefined();
        await expect(application.api.resolveForProject(f.own.id, { kind: 'profile', profileId: detail.id }, 'agent')).rejects.toBeDefined();
        await expect(application.api.projectDevTaskProfile(f.own.id)).rejects.toBeDefined();
      }
      await f.proceed(started, 'verify');
      expect((await f.project.api.completeProjectDeletion(started.lease)).state).toBe('succeeded');
      expect((await fresh.api.deletionOwner!.inspect(target)).resources.every((r) => r.count === 0)).toBe(true);
      await expect(f.project.api.getProject(f.admin, f.own.id)).rejects.toMatchObject({ kind: 'not_found' });
      expect(await f.database.db.execute(sql`SELECT id FROM project.projects WHERE id=${f.own.id}`)).toHaveLength(0);
      const after = await f.database.db.execute(sql`SELECT (SELECT jsonb_agg(to_jsonb(p)) FROM agent_runtime.profiles AS p) AS profiles,(SELECT jsonb_agg(to_jsonb(r)) FROM agent_runtime.profile_revisions AS r) AS revisions,(SELECT jsonb_agg(to_jsonb(t)) FROM agent_runtime.profile_tests AS t) AS tests,(SELECT jsonb_agg(to_jsonb(c)) FROM agent_runtime.profile_credentials AS c) AS credentials,(SELECT jsonb_agg(to_jsonb(v)) FROM agent_runtime.credential_versions AS v) AS versions`);
      expect([...after]).toEqual([...before]);
      expect((await fresh.api.launchMaterialAt(ref, stamp)).beforeStart.secrets).toEqual({ TOKEN: 'fixture-shared-credential' });
      expect([...(await f.database.db.execute(sql`SELECT body FROM agent_runtime.allocation_receipts WHERE operation_id=${f.retainedId}`))]).toEqual([{ body: { private: 'keep-allocation' } }]);
      await expect(Promise.resolve(f.database.db.execute(sql`INSERT INTO agent_runtime.allocation_receipts VALUES (${f.ids[0]!},${f.other.id},'{}'::jsonb)`))).rejects.toBeDefined();
      await expect(Promise.resolve(f.database.db.execute(sql`INSERT INTO agent_runtime.project_compute_policies VALUES (${f.own.id},1,'{}'::jsonb,${f.admin.userId},now())`))).rejects.toBeDefined();
      await expect(Promise.resolve(f.database.db.execute(sql`UPDATE agent_runtime.allocation_receipts SET project_id=${f.own.id} WHERE operation_id=${f.retainedId}`))).rejects.toBeDefined();
      const minimum = await f.database.db.execute(sql`SELECT operation_id,project_id FROM agent_runtime.deletion_identities WHERE project_id=${f.own.id}`);
      expect(minimum).toHaveLength(1205); expect(JSON.stringify(minimum)).not.toContain('private');
      expect(await fresh.api.saveProjectComputePolicy(f.admin, f.other.id, { expectedRevision: 1, policy: f.policy })).toMatchObject({ revision: 2 });
    } finally { await f.database.drop(); }
  }, 30000);

  test('真实未提交写入使 seal 等待；提交后确认变化闭准入，重复旧确认不能变成成功', async () => {
    const f = await computeDeletionFixture();
    try {
      const started = await f.begin(); let unlock!: () => void, entered!: () => void;
      const barrier = new Promise<void>((resolve) => { unlock = resolve; }), admitted = new Promise<void>((resolve) => { entered = resolve; });
      const writer = f.database.db.transaction(async (tx) => { await tx.execute(sql`INSERT INTO agent_runtime.allocation_receipts VALUES (${newResourceId()},${f.own.id},jsonb_build_object('private','late-committed'))`); entered(); await barrier; });
      await admitted; let resolved = false;
      const seal = f.application().api.deletionOwner!.run(started.context).then((result) => { resolved = true; return result; });
      try {
        const deadline = Date.now() + 5000; let waiting = false;
        while (!waiting && Date.now() < deadline) {
          const [row] = await f.database.db.execute<{ waiting: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND NOT granted AND mode='ExclusiveLock' AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND classid::bigint=((hashtextextended(${`agent-runtime.project-admission:${f.own.id}`},0)>>32)&4294967295) AND objid::bigint=(hashtextextended(${`agent-runtime.project-admission:${f.own.id}`},0)&4294967295)) AS waiting`);
          waiting = row?.waiting ?? false;
        }
        expect(waiting).toBe(true); expect(resolved).toBe(false);
      } finally { unlock(); }
      await writer;
      expect(await seal).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
      expect(await f.compute.api.deletionOwner!.run(started.context)).toMatchObject({ kind: 'blocked' });
      await expect(f.compute.api.deletionOwner!.run({ ...started.context, phase: 'metadata' })).rejects.toBeDefined();
      await expect(Promise.resolve(f.database.db.execute(sql`DELETE FROM agent_runtime.allocation_receipts WHERE project_id=${f.own.id}`))).rejects.toBeDefined();
      await expect(f.compute.api.deletionOwner!.run({ ...started.context, operationId: newResourceId() })).rejects.toBeDefined();
    } finally { await f.database.drop(); }
  });

  test('新增未登记内容表拒绝盘点，不能把未知数据解释为空项目', async () => {
    const f = await computeDeletionFixture();
    try {
      await f.database.db.execute(sql`CREATE TABLE agent_runtime.unmapped_content(id text PRIMARY KEY,body jsonb NOT NULL)`);
      await expect(f.compute.api.deletionOwner!.inspect(await f.project.api.deletionScope(f.own.id))).rejects.toMatchObject({ kind: 'precondition' });
    } finally { await f.database.drop(); }
  });

  test('未装配正式删除许可不能建立屏障，事务内的准备记录一并回滚', async () => {
    const f = await computeDeletionFixture();
    try {
      const started = await f.begin();
      await expect(computeDeletionRepository(f.database.db).seal(started.context)).rejects.toMatchObject({ kind: 'precondition' });
      expect(await f.database.db.execute(sql`SELECT project_id FROM agent_runtime.deletion_fences WHERE project_id=${f.own.id}`)).toHaveLength(0);
      expect((await f.compute.api.deletionOwner!.inspect(started.context.target)).resources.some((r) => r.count > 0)).toBe(true);
    } finally { await f.database.drop(); }
  });

  test('确认变化后的持久失败只能用新完整确认和原操作高世代恢复；旧许可与错误owner拒绝', async () => {
    const f = await computeDeletionFixture();
    try {
      const started = await f.begin();
      await f.database.db.execute(sql`UPDATE agent_runtime.allocation_receipts SET body=jsonb_build_object('private','reconfirmed') WHERE project_id=${f.own.id}`);
      expect((await f.compute.api.deletionOwner!.run(started.context)).kind).toBe('blocked');
      await f.project.api.blockProjectDeletion(started.lease, [{ participant: 'agent-runtime', code: 'inventory-changed', message: '确认后新提交' }]);
      const target = await f.project.api.deletionScope(f.own.id), report = await f.compute.api.deletionOwner!.inspect(target);
      const reports = started.plan.participants.map((r) => r.participant === 'agent-runtime' ? report : r);
      const plan = await f.project.api.prepareProjectDeletionReconfirmation(f.admin, started.operation.id, reports);
      await f.project.api.reconfirmProjectDeletion(f.admin, started.operation.id, { planId: plan.id, requestKey: newResourceId(), confirm: 'delete' }, reports);
      const claimed = (await f.project.api.claimProjectDeletion(started.operation.id, 'compute-reconfirmation'))!;
      await expect(f.compute.api.deletionOwner!.run({ ...started.context, generation: claimed.lease.generation })).rejects.toMatchObject({ kind: 'precondition' });
      const context = { ...started.context, generation: claimed.lease.generation, target: plan.target, confirmed: plan.participants.find((p) => p.participant === 'agent-runtime')! };
      expect((await f.compute.api.deletionOwner!.run(context)).kind).toBe('done');
      expect((await f.application().api.deletionOwner!.run(context)).kind).toBe('done');
      await expect(f.compute.api.deletionOwner!.run({ ...context, confirmed: plan.participants.find((p) => p.participant === 'gateway')! })).rejects.toMatchObject({ kind: 'precondition' });
      expect([...(await f.database.db.execute(sql`SELECT scope_verified FROM agent_runtime.deletion_fences WHERE project_id=${f.own.id}`))]).toEqual([{ scope_verified: true }]);
    } finally { await f.database.drop(); }
  });
});
