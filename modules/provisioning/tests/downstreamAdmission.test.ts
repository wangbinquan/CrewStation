import { expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { assertSharedDatabaseAdmissionActive, withSharedDatabaseAdmissions } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { projectWorkFixture } from './projectWorkFixture';

const available = await testDatabaseAvailable();
test.skipIf(!available)('开通预先按完整依赖取锁；下游回调复用原 backend，不能在执行中扩展项目范围', async () => {
  const keys = (id: string) => ['controlled-registry', `controlled-route:${id}`, `controlled-release:${id}`];
  const f = await projectWorkFixture({ sharedAdmissionKeys: keys }), project = f.create();
  let downstream = 0;
  f.repository(async facts => {
    await f.work.checkCurrent(facts.projectId);
    await withSharedDatabaseAdmissions(f.database.db, keys(facts.projectId), async tx => {
      downstream++;
      const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      expect((await f.work.history(facts.projectId))[0]?.backendPid).toBe(backend!.pid);
      assertSharedDatabaseAdmissionActive(f.database.db, 'provisioning.project-admission:' + facts.projectId);
      expect(() => withSharedDatabaseAdmissions(f.database.db, keys(f.create().projectId), async () => undefined)).toThrow('Cannot expand');
      await f.work.checkCurrent(facts.projectId);
    });
  });
  try {
    // 2026-10-09 实机：只取开通锁时，正式网关／首发回调在此报 Cannot expand，项目永远开通失败。
    expect(await f.module.api.provisionProject(project.projectId)).toBe('active');
    expect(downstream).toBe(1);
    expect(f.calls).toContain('routes'); expect(f.calls).toContain('release');
    expect((await f.work.history(project.projectId))[0]?.exited).toBe(true);
    expect(() => assertSharedDatabaseAdmissionActive(f.database.db, keys(project.projectId)[0]!)).toThrow('has exited');
  } finally { await f.drop(); }
}, 15_000);
