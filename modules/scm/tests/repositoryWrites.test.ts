import { describe, expect, test } from 'bun:test';
import { PlatformError, newResourceId } from '@crewstation/kernel';
import type { UserId } from '@crewstation/contracts';
import { runMigrations } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { deferred, repositoryWriteFixture } from './repositoryWriteFixture';
import { scmMigrations } from '../wiring';

const available = await testDatabaseAvailable();

describe.skipIf(!available)('SCM 原回调和逐请求副作用沿革（真实 PostgreSQL）', () => {
  test('建仓、两种凭据和写入均记录原身份；公开历史没有凭据或业务原文', async () => {
    const f = await repositoryWriteFixture();
    try {
      const original = await f.ensure(), session = await f.scm.api.issueSessionCredential(f.serviceId, 15), build = await f.scm.api.issueBuildCredential(f.serviceId, 15);
      await f.scm.api.createReleaseTag(f.serviceId, { branch: 'main', bump: 'minor' });
      await f.scm.api.pushBranch(f.serviceId, '/scratch/private-workdir', 'main');
      await f.scm.api.revokeBuildCredential(f.serviceId, build.id);
      const history = await f.writes().history(f.projectId);
      expect(history.metadataComplete).toBe(true);
      expect(history.bindings).toHaveLength(1);
      expect(history.credentials).toHaveLength(2);
      expect(history.records.map((r) => r.kind).sort()).toEqual(['build-credential', 'credential-revoke', 'ensure-repository', 'push-branch', 'release-tag', 'session-credential']);
      expect(history.records.every((r) => r.state === 'exited' && r.process?.podUid === f.process.podUid && /^[a-f0-9]{64}$/.test(r.exitDigest ?? '') && r.backendPid > 0)).toBe(true);
      expect(history.unresolvedEffects).toHaveLength(0);
      expect(history.records.flatMap((r) => r.effects).some((e) => e.stage === 'returned' && e.remoteProjectId === original.remoteProjectId)).toBe(true);
      const body = JSON.stringify(history);
      expect(body).not.toContain(session.token); expect(body).not.toContain(build.token);
      expect(body).not.toContain(TEST_SECRET); expect(body).not.toContain('tokenHash'); expect(body).not.toContain('/scratch/private-workdir');
      expect(await f.writes().history(f.projectId)).toEqual(history);
    } finally { await f.database.drop(); }
  });

  test('seal 等原回调真实退出；封闭后所有公开写入口和直接 SQL 都拒绝', async () => {
    const f = await repositoryWriteFixture(), entered = deferred(), release = deferred();
    let pending: Promise<unknown> | undefined, sealing: Promise<unknown> | undefined;
    try {
      await f.ensure();
      const build = await f.scm.api.issueBuildCredential(f.serviceId, 15);
      await f.database.db.execute(sql`UPDATE scm.repository_bindings SET web_url=NULL WHERE service_id=${f.serviceId}`);
      const create = f.gitlab.gateway.createAccessToken;
      f.gitlab.gateway.createAccessToken = async (...args) => { entered.resolve(); await release.promise; return create(...args); };
      pending = f.scm.api.issueSessionCredential(f.serviceId, 15); await entered.promise;
      sealing = f.writes().close(f.context);
      const row = await waitFor(f.database.db, sql`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock(%') AS ready`);
      expect(row).toBe(true);
      const originalWork = (await f.writes().history(f.projectId)).records.find((r) => r.kind === 'session-credential')!;
      expect(originalWork.state).toBe('running');
      await expect(Promise.resolve(f.database.db.execute(sql`UPDATE scm.deletion_work SET state='exited',result='succeeded',exit_digest=repeat('a',64) WHERE id=${originalWork.id}`))).rejects.toMatchObject({ cause: { code: '55000' } });
      release.resolve(); await pending; await sealing;
      const count = f.gitlab.calls.length;
      for (const write of [() => f.ensure(), () => f.scm.api.issueSessionCredential(f.serviceId, 15), () => f.scm.api.issueBuildCredential(f.serviceId, 15),
        () => f.scm.api.createReleaseTag(f.serviceId, { branch: 'main', bump: 'patch' }), () => f.scm.api.pushBranch(f.serviceId, '/scratch/closed', 'main'),
        () => f.scm.api.revokeBuildCredential(f.serviceId, build.id), () => f.scm.api.getBinding({ userId: newResourceId() as UserId, isAdmin: true }, f.serviceId)]) {
        await expect(write()).rejects.toMatchObject({ kind: 'precondition' });
      }
      expect(f.gitlab.calls).toHaveLength(count);
      f.clock.advanceMinutes(16); expect(await f.scm.api.revokeExpiredCredentials()).toBe(0); expect(f.gitlab.calls).toHaveLength(count);
      await expect(Promise.resolve(f.database.db.execute(sql`UPDATE scm.repository_bindings SET web_url=NULL WHERE service_id=${f.serviceId}`))).rejects.toMatchObject({ cause: { code: '55000' } });
      await expect(Promise.resolve(f.database.db.execute(sql`DELETE FROM scm.session_credentials WHERE service_id=${f.serviceId}`))).rejects.toMatchObject({ cause: { code: '55000' } });
      await expect(f.writes().close({ ...f.context, operationId: newResourceId() })).rejects.toMatchObject({ kind: 'precondition' });
      expect(f.grants()).toBeGreaterThan(0);
    } finally { release.resolve(); await pending?.catch(() => undefined); await sealing?.catch(() => undefined); await f.database.drop(); }
  }, 15000);

  test('远端成功但返回丢失仍有未闭合意图，不能当作从未签发或已回收', async () => {
    const f = await repositoryWriteFixture();
    try {
      await f.ensure();
      const create = f.gitlab.gateway.createAccessToken;
      f.gitlab.gateway.createAccessToken = async (...args) => { await create(...args); throw new PlatformError('unavailable', 'original response lost'); };
      await expect(f.scm.api.issueSessionCredential(f.serviceId, 15)).rejects.toMatchObject({ kind: 'unavailable' });
      const history = await f.writes().history(f.projectId), work = history.records.find((r) => r.kind === 'session-credential')!;
      expect(work.state).toBe('exited'); expect(work.result).toBe('failed');
      expect(work.effects).toHaveLength(1); expect(work.effects[0]?.stage).toBe('intent');
      expect(history.unresolvedEffects).toEqual([{ workId: work.id, intentId: work.effects[0]!.intentId }]);
      expect(history.credentials).toHaveLength(0);
      expect(f.gitlab.get('100').tokens.size).toBe(1);
      expect(JSON.stringify(history)).not.toContain('original response lost');
    } finally { await f.database.drop(); }
  });

  test('backend 消失不等于回调停止；原回调迟到结果先保留，再被关闭的普通 UOW 拒绝', async () => {
    const f = await repositoryWriteFixture(), entered = deferred(), release = deferred();
    let pending: Promise<unknown> | undefined;
    try {
      await f.ensure();
      const create = f.gitlab.gateway.createAccessToken;
      f.gitlab.gateway.createAccessToken = async (...args) => { entered.resolve(); await release.promise; return create(...args); };
      pending = f.scm.api.issueSessionCredential(f.serviceId, 15); const rejected = pending.catch(() => undefined); await entered.promise;
      const work = (await f.writes().history(f.projectId)).records.find((r) => r.kind === 'session-credential')!;
      await f.database.db.execute(sql`SELECT pg_terminate_backend(${work.backendPid})`); await rejected;
      await f.writes().close(f.context);
      await f.writes().recover({ ...f.context, phase: 'stop' });
      expect((await f.writes().history(f.projectId)).records.find((r) => r.id === work.id)?.state).toBe('running');
      release.resolve();
      expect(await waitFor(f.database.db, sql`SELECT EXISTS(SELECT 1 FROM scm.deletion_work WHERE id=${work.id} AND state='exited') AS ready`)).toBe(true);
      const after = await f.writes().history(f.projectId), original = after.records.find((r) => r.id === work.id)!;
      expect(original.result).toBe('failed');
      expect(original.effects.map((e) => e.stage)).toEqual(['intent', 'returned']);
      expect(after.credentials).toHaveLength(0);
      expect(after.unresolvedEffects).toHaveLength(0);
      expect(f.gitlab.get('100').tokens.size).toBe(1);
    } finally { release.resolve(); await pending?.catch(() => undefined); await f.database.drop(); }
  }, 15000);

  test('原 Bun 子进程被杀且未执行 finally，只有独立原实例停止来源能收尾，结果意图不被抹掉', async () => {
    const f = await repositoryWriteFixture(); let child: ReturnType<typeof Bun.spawn> | undefined;
    try {
      await f.ensure();
      const source = `import {connectDatabase} from './packages/persistence';
        import {createScmModule} from './modules/scm/wiring';
        import {TEST_SETTINGS,fakeGitLab} from './modules/scm/tests/fakeAdapters';
        const database=connectDatabase(process.env.CS_TEST_DATABASE_URL),gitlab=fakeGitLab();gitlab.add('crewstation/write-proof','100');
        gitlab.gateway.createAccessToken=async()=>{process.stdout.write('entered\\n');return new Promise(()=>{});};
        const scm=createScmModule({db:database.db,settings:TEST_SETTINGS,project:{authorize:async()=>undefined,isAdmin:async()=>false},
          processes:{protectCurrent:async()=>(${JSON.stringify(f.process)}),sweep:async()=>{}},overrides:{gitlab:gitlab.gateway}});
        await scm.api.issueSessionCredential('${f.serviceId}',15);`;
      child = Bun.spawn([process.execPath, '-e', source], { cwd: process.cwd(), env: { ...process.env, CS_TEST_DATABASE_URL: f.database.url }, stdout: 'pipe', stderr: 'pipe' });
      const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
      const first = await reader.read(); reader.releaseLock();
      if (first.done) throw new Error('Original Bun child exited before admission: ' + (await new Response(child.stderr as ReadableStream<Uint8Array>).text()).slice(0, 1500));
      expect(new TextDecoder().decode(first.value)).toBe('entered\n');
      const work = (await f.writes().history(f.projectId)).records.find((r) => r.kind === 'session-credential')!;
      expect(work.callbackPid).toBe(child.pid); expect(work.state).toBe('running');
      child.kill('SIGKILL'); await child.exited;
      expect((await f.writes().history(f.projectId)).records.find((r) => r.id === work.id)?.state).toBe('running');
      f.stopProcess();
      // Source is a controlled container port; the actual Bun exit and PostgreSQL work are real.
      expect(await f.scm.api.revokeExpiredCredentials()).toBe(0);
      const after = await f.writes().history(f.projectId), exited = after.records.find((r) => r.id === work.id)!;
      expect(exited.state).toBe('exited'); expect(exited.result).toBe('interrupted'); expect(exited.effects).toEqual(work.effects);
      expect(after.unresolvedEffects).toHaveLength(1); expect(f.grants()).toBe(0);
      await f.scm.api.revokeExpiredCredentials(); expect(await f.writes().history(f.projectId)).toEqual(after);
    } finally { if (child && child.exitCode === null) { child.kill('SIGKILL'); await child.exited; } await f.database.drop(); }
  }, 15000);

  test('旧库升级保留1001个绑定和凭据的全部历史，没有补造旧回调或远端创建时间', async () => {
    const f = await repositoryWriteFixture(true);
    try {
      const rows = Array.from({ length: 1001 }, (_, index) => ({ serviceId: index ? newResourceId() : f.serviceId, credentialId: newResourceId(), remote: String(100 + index) }));
      await f.database.db.execute(sql`INSERT INTO scm.repository_bindings(service_id,project_id,provider,remote_project_id,path_with_namespace,http_url,web_url,default_branch,state,message,created_at,updated_at) SELECT r->>'serviceId',${f.projectId},'gitlab',r->>'remote','crewstation/legacy-' || (r->>'remote'),'https://private.invalid/' || (r->>'remote'),NULL,'main','failed','legacy-business-secret',now(),now() FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) r`);
      await f.database.db.execute(sql`INSERT INTO scm.session_credentials(id,service_id,remote_token_id,token_hash,expires_at,created_at,revoked_at) SELECT r->>'credentialId',r->>'serviceId',r->>'remote',repeat('b',64),now(),now(),NULL FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) r`);
      await runMigrations(f.database.db, [scmMigrations]);
      const history = await f.writes().history(f.projectId);
      expect(history.bindings).toHaveLength(1001); expect(history.credentials).toHaveLength(1001); expect(history.origins).toHaveLength(1001);
      expect(history.records).toHaveLength(0); expect(history.origins.every((r) => r.source === 'legacy-binding' && r.createdAt === null)).toBe(true);
      expect(JSON.stringify(history)).not.toContain('legacy-business-secret'); expect(JSON.stringify(history)).not.toContain('private.invalid');
      await expect(Promise.resolve(f.database.db.execute(sql`UPDATE scm.session_credentials SET remote_token_id='999999' WHERE id=${rows[0]!.credentialId}`))).rejects.toMatchObject({ cause: { code: '55000' } });
      await expect(Promise.resolve(f.database.db.execute(sql`UPDATE scm.repository_bindings SET project_id=${newResourceId()} WHERE service_id=${f.serviceId}`))).rejects.toMatchObject({ cause: { code: '55000' } });
      expect(await f.writes().history(f.projectId)).toEqual(history);
      await f.database.db.execute(sql`CREATE TABLE scm.future_project_content(id text)`);
      await expect(f.writes().history(f.projectId)).rejects.toMatchObject({ kind: 'precondition' });
    } finally { await f.database.drop(); }
  }, 15000);

  test('原远端已经创建而普通绑定失败，仍保存原 ID 与原返回时间；同名对象不会被重试接管', async () => {
    const f = await repositoryWriteFixture();
    try {
      const create = f.gitlab.gateway.createProject, createdAt = '2026-09-30T16:00:35.872Z';
      f.gitlab.gateway.createProject = async (...args) => ({ ...await create(...args), createdAt });
      await f.database.db.execute(sql`CREATE FUNCTION scm.reject_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'normal binding transaction failed' USING ERRCODE='23514'; END $$`);
      await f.database.db.execute(sql`CREATE TRIGGER reject_binding BEFORE INSERT ON scm.repository_bindings FOR EACH ROW EXECUTE FUNCTION scm.reject_binding()`);
      await expect(f.ensure()).rejects.toMatchObject({ cause: { code: '23514' } });
      const history = await f.writes().history(f.projectId);
      expect(history.bindings).toHaveLength(0); expect(history.origins).toEqual([{ serviceId: f.serviceId, remoteProjectId: '100', pathWithNamespace: 'crewstation/write-proof', createdAt, source: 'callback-result' }]);
      expect(history.records[0]?.result).toBe('failed'); expect(history.unresolvedEffects).toHaveLength(0);
      await expect(f.ensure()).rejects.toMatchObject({ kind: 'conflict' });
      expect(f.gitlab.projects.size).toBe(1); expect((await f.writes().history(f.projectId)).origins).toEqual(history.origins);
    } finally { await f.database.drop(); }
  });

  test('失败绑定更换远端数字 ID 后，旧与新原仓库身份同时保留，原服务不能借给其他项目', async () => {
    const f = await repositoryWriteFixture();
    try {
      await f.ensure();
      await f.database.db.execute(sql`UPDATE scm.repository_bindings SET state='failed' WHERE service_id=${f.serviceId}`);
      f.gitlab.projects.delete('100');
      expect((await f.ensure()).remoteProjectId).toBe('101');
      const history = await f.writes().history(f.projectId);
      expect(history.origins.map((r) => r.remoteProjectId).sort()).toEqual(['100', '101']);
      await expect(f.scm.api.ensureRepository(f.serviceId, newResourceId() as typeof f.projectId, { slug: 'replacement', templateId: '01a0bf5d-8f4b-7002-9560-94caf593fb19' })).rejects.toMatchObject({ kind: 'precondition' });
      expect(await f.writes().history(f.projectId)).toEqual(history);
      await expect(Promise.resolve(f.database.db.execute(sql`DELETE FROM scm.deletion_repository_origins WHERE service_id=${f.serviceId}`))).rejects.toMatchObject({ cause: { code: '55000' } });
    } finally { await f.database.drop(); }
  });
});

const TEST_SECRET = 'glpat-platform-secret';
async function waitFor(db: Awaited<ReturnType<typeof repositoryWriteFixture>>['database']['db'], query: Parameters<typeof db.execute>[0]) {
  const deadline = Date.now() + 5000;
  do { if ((await db.execute<{ ready: boolean }>(query))[0]?.ready) return true; await Bun.sleep(20); } while (Date.now() < deadline);
  return false;
}
