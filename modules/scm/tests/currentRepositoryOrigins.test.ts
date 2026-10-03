import { describe, expect, test } from 'bun:test';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { scmCurrentRepositoryOrigins, ScmCurrentRepositoryOriginsWitnessSchema } from '../application/currentRepositoryOrigins';
import { scmDeletionFixture } from './projectDeletionFixture';
import { currentOriginsHistory, currentOriginsMaterial } from './currentRepositoryOriginsFixture';
import { scmRepositoryWrites } from '../adapters/persistence/repositoryAdmission';
import type { ScmCurrentRepositoryOriginsSource } from '../ports/currentRepositoryOrigins';

describe('当前原仓库归属与旧回调缺失分别核对', () => {
  test('当前身份不补造原创建回执；顺序变化不改变固定摘要', () => {
    const f = currentOriginsHistory();
    const secondId = newResourceId(), history = { ...f.history,
      credentials: [...f.history.credentials, { id: secondId, serviceId: f.serviceId, remoteTokenId: '1002' }],
      identities: [...f.history.identities, { kind: 'credential' as const, id: secondId, serviceId: f.serviceId }] };
    const before = structuredClone(history), raw = currentOriginsMaterial(history);
    const witness = scmCurrentRepositoryOrigins(f.projectId, history, raw);
    expect(witness.repositories[0]?.createdAt).toBe('2026-09-11T00:00:00.000Z');
    expect(witness.credentials.find((row) => row.platformCredentialId === f.credentialId)).toMatchObject({ historicalCreatedAt: null, historicalUserId: null });
    expect(witness.historicalCallbacksReconstructed).toBe(false); expect(history).toEqual(before);
    const shuffled = { ...raw, repositories: raw.repositories.map((row) => ({ ...row, apiTokens: [...row.apiTokens].reverse(), nativeTokens: [...row.nativeTokens].reverse(), relatedTokens: [...row.relatedTokens].reverse(), users: [...row.users].reverse(), memberships: [...row.memberships].reverse() })) };
    expect(scmCurrentRepositoryOrigins(f.projectId, history, shuffled).digest).toBe(witness.digest);
    const replacement = { ...witness, repositories: [] }; expect(ScmCurrentRepositoryOriginsWitnessSchema.safeParse(replacement).success).toBe(false);
  });
  test('实例更换、原仓库身份冲突、共享机器人、缺页与隐藏秘密都拒绝', () => {
    const f = currentOriginsHistory();
    const variants: ((raw: ReturnType<typeof currentOriginsMaterial>) => unknown)[] = [
      (raw) => ({ ...raw, after: { ...raw.after, id: 'replacement' } }),
      (raw) => ({ ...raw, repositories: [] }),
      (raw) => ({ ...raw, repositories: [...raw.repositories, raw.repositories[0]!] }),
      (raw) => ({ ...raw, repositories: raw.repositories.map((row) => ({ ...row, remoteProjectId: '999' })) }),
      (raw) => ({ ...raw, repositories: raw.repositories.map((row) => ({ ...row, pathWithNamespace: 'crewstation/replacement' })) }),
      (raw) => ({ ...raw, repositories: raw.repositories.map((row) => ({ ...row, nativeTokens: [] })) }),
      (raw) => ({ ...raw, repositories: raw.repositories.map((row) => ({ ...row, relatedTokens: [] })) }),
      (raw) => ({ ...raw, repositories: raw.repositories.map((row) => ({ ...row, users: row.users.map((user) => ({ ...user, userType: 'human' })) })) }),
      (raw) => ({ ...raw, repositories: raw.repositories.map((row) => ({ ...row, memberships: row.memberships.map((member) => ({ ...member, sourceId: '999' })) })) }),
      (raw) => ({ ...raw, repositories: raw.repositories.map((row) => ({ ...row, memberships: [...row.memberships, { ...row.memberships[0]!, id: '999' }] })) }),
      (raw) => ({ ...raw, repositories: raw.repositories.map((row) => ({ ...row, apiTokens: row.apiTokens.map((token) => ({ ...token, name: 'unrelated-token' })) })) }),
      (raw) => ({ ...raw, secret: 'controlled-not-real-secret' }),
    ];
    for (const mutate of variants) expect(() => scmCurrentRepositoryOrigins(f.projectId, f.history, mutate(currentOriginsMaterial(f.history)) as ReturnType<typeof currentOriginsMaterial>)).toThrow();
  });
  test('未知归属、跨项目引用和未闭合请求没有当前身份恢复例外', () => {
    const f = currentOriginsHistory(), raw = currentOriginsMaterial(f.history);
    for (const history of [{ ...f.history, metadataComplete: false }, { ...f.history, unownedCredentialIds: [newResourceId()] },
      { ...f.history, foreignRepositoryReferences: [{ remoteProjectId: '100', projectId: newResourceId() as typeof f.projectId }] },
      { ...f.history, unresolvedEffects: [{ workId: newResourceId(), intentId: newResourceId() }] }]) expect(() => scmCurrentRepositoryOrigins(f.projectId, history, raw)).toThrow();
  });
  test('已知原创建时间和每一个已返回令牌身份不能由当前事实替换', () => {
    const f = currentOriginsHistory(), raw = currentOriginsMaterial(f.history);
    const effect = { intentId: newResourceId(), kind: 'credential' as const, stage: 'returned' as const, remoteProjectId: '100', remoteTokenId: '1001', credentialId: f.credentialId,
      createdAt: '2026-09-11T00:01:00.000Z', userId: '501' };
    const record = { id: newResourceId(), serviceId: f.serviceId, kind: 'session-credential' as const, state: 'exited' as const, remoteProjectId: '100', backendPid: 20, callbackPid: 21,
      callbackStartedAt: '2026-09-11T00:00:00.000Z', process: null, result: 'succeeded' as const, exitDigest: jsonHash('controlled original exit'), effects: [effect] };
    expect(scmCurrentRepositoryOrigins(f.projectId, { ...f.history, records: [record] }, raw).credentials[0]?.historicalUserId).toBe('501');
    for (const changed of [{ ...effect, userId: '599' }, { ...effect, createdAt: '2026-09-12T00:01:00.000Z' }, { ...effect, remoteTokenId: '9999' }, { ...effect, remoteProjectId: '9999' }])
      expect(() => scmCurrentRepositoryOrigins(f.projectId, { ...f.history, records: [{ ...record, effects: [effect, changed] }] }, raw)).toThrow();
    expect(() => scmCurrentRepositoryOrigins(f.projectId, { ...f.history, origins: f.history.origins.map((row) => ({ ...row, createdAt: '2026-09-12T00:00:00.000Z' })) }, raw)).toThrow();
    expect(() => scmCurrentRepositoryOrigins(f.projectId, { ...f.history, identities: [] }, raw)).toThrow();
  });
});

const available = await testDatabaseAvailable();
describe.skipIf(!available)('旧库正式清理入口（真实 PG；原生来源是受控端口）', () => {
  test('固定当前归属后沿全部阶段清理；SQL历史仍保持缺失，其他项目保持', async () => {
    const source: ScmCurrentRepositoryOriginsSource = { read: async (_target, history) => currentOriginsMaterial(history) };
    const f = await scmDeletionFixture({ legacy: true, currentOrigins: source });
    try {
      const context = await f.prepare(), original = await f.writes().history(f.projectId);
      const otherProject = newResourceId() as typeof f.projectId, otherService = newResourceId() as typeof f.serviceId;
      const issue = f.gitlab.gateway.createAccessToken;
      f.gitlab.gateway.createAccessToken = async (...args) => ({ ...await issue(...args), userId: '599' });
      await f.scm.api.ensureRepository(otherService, otherProject, { slug: 'retained-other-current-origin', templateId: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
      await f.scm.api.issueSessionCredential(otherService, 15); f.gitlab.gateway.createAccessToken = issue;
      const otherBefore = await f.writes().history(otherProject);
      expect(original.origins[0]?.createdAt).toBeNull(); expect(original.records).toHaveLength(0); expect(context.confirmed.complete).toBe(true);
      expect(context.confirmed.resources.filter((row) => row.kind === 'gitlab-current-origins')).toHaveLength(1);
      await f.run('seal');
      const [row] = await f.database.db.execute<{ original: { plan: { repositories: { createdAt: string | null }[]; currentOrigins: { historicalCallbacksReconstructed: boolean } } } }>(sql`SELECT original FROM scm.deletion_scopes`);
      expect(row?.original.plan.repositories[0]?.createdAt).toBeNull(); expect(row?.original.plan.currentOrigins.historicalCallbacksReconstructed).toBe(false);
      expect(await f.writes().history(f.projectId)).toEqual(original);
      f.state.consumersStopped = false; expect((await f.run('stop')).kind).toBe('blocked'); await expect(f.run('metadata')).rejects.toMatchObject({ kind: 'precondition' });
      f.state.consumersStopped = true;
      for (const phase of ['stop', 'purge', 'prove', 'namespace', 'metadata', 'verify'] as const) expect((await f.run(phase)).kind).toBe('done');
      expect((await f.writes().history(f.projectId)).metadataCount).toBe(0);
      expect(await f.writes().history(otherProject)).toEqual(otherBefore);
    } finally { await f.database.drop(); }
  });
  test('当前归属读取期间新的真实原请求发生，旧盘点不能进入物理捕获', async () => {
    let beforeRead: (() => Promise<void>) | undefined;
    const source: ScmCurrentRepositoryOriginsSource = { read: async (_target, history) => { await beforeRead?.(); return currentOriginsMaterial(history); } };
    const f = await scmDeletionFixture({ legacy: true, currentOrigins: source });
    try {
      await f.prepare(); const captures = f.state.captures, remoteProjectId = (await f.writes().history(f.projectId)).origins[0]!.remoteProjectId;
      const writes = scmRepositoryWrites({ db: f.database.db, processes: { protectCurrent: async () => f.process, sweep: async () => undefined } });
      beforeRead = async () => { await writes.withAdmission(f.projectId, f.serviceId, 'build-credential', async () => {
        await writes.record({ intentId: newResourceId(), credentialId: newResourceId(), kind: 'credential', stage: 'intent', remoteProjectId });
      }); };
      const report = await f.owner.inspect(f.context().target);
      expect(report.complete).toBe(false); expect(report.blockers.map((row) => row.code)).toContain('scm-source-history-changed'); expect(f.state.captures).toBe(captures);
      const unresolved = await f.writes().history(f.projectId); expect(unresolved.unresolvedEffects).toHaveLength(1);
      expect((await f.owner.inspect(f.context().target)).blockers.map((row) => row.code)).toContain('scm-effect-unresolved');
    } finally { await f.database.drop(); }
  });
});
