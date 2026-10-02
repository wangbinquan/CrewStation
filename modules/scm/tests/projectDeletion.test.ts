import { describe, expect, test } from 'bun:test';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { runMigrations } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { scmDeletionFixture } from './projectDeletionFixture';
import { repositoryWriteFixture } from './repositoryWriteFixture';
import { scmMigrations } from '../wiring';
import type { ScmDeletionProof } from '../ports/projectDeletion';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('SCM 正式 owner 的持久原范围与阶段（真实 PostgreSQL；物理来源为受控端口）', () => {
  test('全部阶段清除本项目全部内容与别名，只留最小墓碑；最终仍读原物理范围', async () => {
    const f = await scmDeletionFixture();
    try {
      const context = await f.prepare(); expect(context.confirmed.complete).toBe(true); expect(context.confirmed.references).toEqual([]);
      expect(context.confirmed.resources.filter((entry) => entry.kind.startsWith('gitlab-coverage:'))).toHaveLength(11);
      const body = JSON.stringify(context.confirmed); expect(body).not.toContain('glpat-'); expect(body).not.toContain('controlled original service alias'); expect(body).not.toContain('original-main-inode');
      for (const phase of ['seal', 'stop', 'purge', 'prove', 'namespace', 'metadata', 'verify'] as const) expect((await f.run(phase)).kind).toBe('done');
      const remaining = await f.writes().history(f.projectId); expect(remaining.metadataCount).toBe(0); expect(remaining.bindings).toEqual([]); expect(remaining.records).toEqual([]); expect(remaining.origins).toEqual([]); expect(remaining.credentials).toEqual([]);
      expect(await f.database.db.execute(sql`SELECT project_id FROM scm.deletion_scopes`)).toHaveLength(0);
      const tombstones = await f.database.db.execute<{ operation_id: string; completed_digest: string }>(sql`SELECT operation_id,completed_digest FROM scm.deletion_fences`);
      expect(tombstones).toHaveLength(1); expect(tombstones[0]?.operation_id).toBe(context.operationId); expect(tombstones[0]?.completed_digest).toMatch(/^[a-f0-9]{64}$/);
      expect(f.calls.filter((entry) => entry.phase === 'prove')).toHaveLength(3); expect(new Set(f.calls.map((entry) => jsonHash(entry.scope))).size).toBe(1);
      expect((await f.run('verify')).kind).toBe('done'); await expect(f.run('purge')).rejects.toMatchObject({ kind: 'precondition' });
      await expect(f.ensure()).rejects.toMatchObject({ kind: 'precondition', details: { code: 'scm_project_sealed' } });
    } finally { await f.database.drop(); }
  });
  test('API 原实体已消失而原文件仍在时等待；权限不全或真实消费者活动不能生成物理证明', async () => {
    const f = await scmDeletionFixture();
    try {
      await f.prepare(); await f.run('seal'); f.state.consumersStopped = false;
      expect(await f.run('stop')).toMatchObject({ kind: 'blocked', blockers: [{ code: 'scm-consumers-unproven' }] });
      f.state.consumersStopped = true; f.state.independent = false; expect((await f.run('stop')).kind).toBe('blocked');
      f.state.independent = true; await f.run('stop'); await f.run('purge'); f.state.storageRemaining = 1;
      expect((await f.run('prove')).kind).toBe('waiting');
      const [row] = await f.database.db.execute<{ prove_digest: string | null }>(sql`SELECT prove_digest FROM scm.deletion_scopes`); expect(row?.prove_digest).toBeNull();
      await expect(f.run('metadata')).rejects.toMatchObject({ kind: 'precondition' }); expect((await f.writes().history(f.projectId)).metadataCount).toBeGreaterThan(0);
    } finally { await f.database.drop(); }
  });
  test('原生受理后丢回执，新世代沿原范围继续；重放不重新捕获同名仓库', async () => {
    const f = await scmDeletionFixture();
    try {
      await f.prepare(); await f.run('seal'); await f.run('stop'); const captures = f.state.captures; f.state.losePurgeResponse = true;
      await expect(f.run('purge')).rejects.toThrow('Controlled native response lost');
      const [row] = await f.database.db.execute<{ purge_digest: string | null }>(sql`SELECT purge_digest FROM scm.deletion_scopes`); expect(row?.purge_digest).toBeNull();
      expect((await f.run('purge', { generation: 2 })).kind).toBe('done'); expect((await f.run('prove', { generation: 2 })).kind).toBe('done');
      expect(f.state.captures).toBe(captures); expect(new Set(f.calls.filter((entry) => entry.phase === 'purge').map((entry) => jsonHash(entry.scope))).size).toBe(1);
      await expect(f.run('stop')).rejects.toMatchObject({ kind: 'precondition' });
      await expect(f.run('stop', { generation: 2, operationId: newResourceId() })).rejects.toMatchObject({ kind: 'precondition' });
    } finally { await f.database.drop(); }
  });
  test('副作用后原许可失效，不落阶段证明；缺少前序阶段也不进入物理请求', async () => {
    const f = await scmDeletionFixture();
    try {
      await f.prepare(); await f.run('seal'); await expect(f.run('purge')).rejects.toMatchObject({ kind: 'precondition' }); expect(f.calls).toEqual([]);
      f.state.afterEffect = f.revokeGrant; await expect(f.run('stop')).rejects.toMatchObject({ kind: 'precondition' });
      const [row] = await f.database.db.execute<{ stop_digest: string | null }>(sql`SELECT stop_digest FROM scm.deletion_scopes`); expect(row?.stop_digest).toBeNull();
    } finally { await f.database.drop(); }
  });
  test('原物理范围、退休墓碑、封闭别名和凭据都不允许直接 SQL 替换或提前清理', async () => {
    const f = await scmDeletionFixture();
    try {
      await f.prepare(); await f.run('seal');
      for (const statement of [sql`UPDATE scm.deletion_scopes SET original=jsonb_set(original,'{source,identity}',to_jsonb(repeat('b',64)))`, sql`DELETE FROM scm.deletion_scopes`,
        sql`DELETE FROM scm.deletion_fences`, sql`UPDATE scm.deletion_fences SET operation_id=NULL`, sql`DELETE FROM scm.deletion_identities`, sql`DELETE FROM scm.deletion_repository_origins`,
        sql`DELETE FROM scm.deletion_work`, sql`DELETE FROM scm.resource_identity_aliases`, sql`UPDATE scm.resource_identity_aliases SET id=${newResourceId()}`]) {
        await expect(Promise.resolve(f.database.db.execute(statement))).rejects.toMatchObject({ cause: { code: '55000' } });
      }
      expect((await f.run('seal')).kind).toBe('done'); expect(f.state.captures).toBe(2);
    } finally { await f.database.drop(); }
  });
  test('缺失存储类别、同名替换、其他项目引用与旧来源未知均不能获得完整盘点', async () => {
    const f = await scmDeletionFixture();
    try {
      await f.ensure(); f.state.transformScope = (scope) => ({ ...scope, coverage: scope.coverage.slice(1) });
      await expect(f.owner.inspect(f.context().target)).rejects.toMatchObject({ kind: 'precondition' });
      f.state.transformScope = (scope) => ({ ...scope, repositories: scope.repositories.map((entry) => ({ ...entry, createdAt: '2026-09-12T00:00:00.000Z' })) });
      await expect(f.owner.inspect(f.context().target)).rejects.toMatchObject({ kind: 'precondition' });
      f.state.transformScope = (scope) => scope; f.state.report = { complete: true, blockers: [], references: [{ kind: 'shared-bot', id: '501', projectId: newResourceId() as typeof f.projectId, description: 'Controlled other-project membership' }] };
      expect((await f.owner.inspect(f.context().target)).complete).toBe(false);
      const legacy = await repositoryWriteFixture(false, f.physics);
      try { await legacy.ensure(); const report = await legacy.scm.api.deletionOwner!.inspect(legacy.context.target); expect(report.complete).toBe(false); expect(report.blockers.map((entry) => entry.code)).toContain('scm-origin-unrecorded'); }
      finally { await legacy.database.drop(); }
    } finally { await f.database.drop(); }
  });
  test('新增未登记内容表阻断完整复核，metadata 事务回滚并保留原材料', async () => {
    const f = await scmDeletionFixture();
    try {
      await f.prepare(); for (const phase of ['seal', 'stop', 'purge', 'prove'] as const) await f.run(phase);
      await f.database.db.execute(sql`CREATE TABLE scm.unregistered_material(project_id text)`);
      await expect(f.run('metadata')).rejects.toMatchObject({ kind: 'precondition' });
      const [row] = await f.database.db.execute<{ scope_verified: boolean }>(sql`SELECT scope_verified FROM scm.deletion_fences`); expect(row?.scope_verified).toBe(false);
      expect(await f.database.db.execute(sql`SELECT id FROM scm.session_credentials`)).toHaveLength(2); expect(await f.database.db.execute(sql`SELECT id FROM scm.resource_identity_aliases`)).toHaveLength(2);
    } finally { await f.database.drop(); }
  });
  test('清理只影响原项目，其他项目全部元数据与凭据保持原摘要', async () => {
    const f = await scmDeletionFixture();
    try {
      await f.prepare(); const otherProject = newResourceId() as typeof f.projectId, otherService = newResourceId() as typeof f.serviceId;
      await f.scm.api.ensureRepository(otherService, otherProject, { slug: 'retained-other-project', templateId: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
      await f.scm.api.issueSessionCredential(otherService, 15); await f.database.db.execute(sql`INSERT INTO scm.resource_identity_aliases VALUES('service','controlled retained other alias',${otherService})`);
      const before = await f.writes().history(otherProject);
      for (const phase of ['seal', 'stop', 'purge', 'prove', 'metadata', 'verify'] as const) await f.run(phase);
      expect(await f.writes().history(otherProject)).toEqual(before); expect((await f.writes().history(f.projectId)).metadataCount).toBe(0);
    } finally { await f.database.drop(); }
  });
  test('伪造独立证明的来源或原范围、缺失完整性与隐藏属性都不能落证明', async () => {
    const f = await scmDeletionFixture();
    try {
      await f.prepare(); await f.run('seal'); const original = f.physics.stop;
      f.physics.stop = async (...args) => { const proof = await original(...args); if (proof.kind !== 'done') throw new Error('Expected controlled proof'); return { ...proof, sourceIdentity: jsonHash('replacement source') }; };
      await expect(f.run('stop')).rejects.toMatchObject({ kind: 'precondition' });
      f.physics.stop = async (...args) => { const proof = await original(...args); if (proof.kind !== 'done') throw new Error('Expected controlled proof'); return { ...proof, scopeDigest: jsonHash('replacement original scope') }; };
      await expect(f.run('stop')).rejects.toMatchObject({ kind: 'precondition' });
      f.physics.stop = async () => ({ kind: 'blocked', blockers: [{ participant: 'scm', code: 'source-unavailable', message: 'Controlled independent source unavailable' }] });
      expect((await f.run('stop')).kind).toBe('blocked'); f.physics.stop = async () => ({ kind: 'waiting', reason: 'Controlled original native job still active' });
      expect((await f.run('stop')).kind).toBe('waiting');
      f.physics.stop = async (...args) => ({ ...await original(...args), hiddenAccessToken: 'controlled-secret' } as unknown as ScmDeletionProof);
      await expect(f.run('stop')).rejects.toThrow('Unrecognized key');
      const [row] = await f.database.db.execute<{ stop_digest: string | null }>(sql`SELECT stop_digest FROM scm.deletion_scopes`); expect(row?.stop_digest).toBeNull();
      f.physics.stop = original; expect((await f.run('stop')).kind).toBe('done');
    } finally { await f.database.drop(); }
  });
  test('旧库跨项目远端引用完整保留；本项目行消失后仍可按原远端 ID 复核', async () => {
    const f = await repositoryWriteFixture(true);
    try {
      const otherProject = newResourceId() as typeof f.projectId, otherService = newResourceId() as typeof f.serviceId;
      await f.database.db.execute(sql`INSERT INTO scm.repository_bindings(service_id,project_id,provider,remote_project_id,path_with_namespace,http_url,default_branch,state,created_at,updated_at)
        VALUES(${f.serviceId},${f.projectId},'gitlab','383','crewstation/old-shared-native','https://controlled.invalid/old','main','ready',now(),now()),
              (${otherService},${otherProject},'gitlab','383','crewstation/other-old-native-path','https://controlled.invalid/other-old','main','ready',now(),now())`);
      await runMigrations(f.database.db, [{ ...scmMigrations, files: scmMigrations.files.filter((file) => !file.name.startsWith('0007_')) }]);
      const before = await f.writes().history(f.projectId); expect(before.foreignRepositoryReferences).toEqual([{ remoteProjectId: '383', projectId: otherProject }]);
      await runMigrations(f.database.db, [scmMigrations]); expect(await f.writes().history(f.projectId)).toEqual(before);
      const noCurrentRows = await f.writes().history(newResourceId() as typeof f.projectId, ['383']);
      expect(noCurrentRows.bindings).toEqual([]); expect(noCurrentRows.foreignRepositoryReferences).toHaveLength(2);
      await expect(Promise.resolve(f.database.db.execute(sql`UPDATE scm.repository_bindings SET path_with_namespace='crewstation/reassigned-shared' WHERE service_id=${otherService}`))).rejects.toMatchObject({ cause: { code: '55000' } });
    } finally { await f.database.drop(); }
  });
});
