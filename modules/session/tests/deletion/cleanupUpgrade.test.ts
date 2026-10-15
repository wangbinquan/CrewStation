// 0015 的追加修复：旧守卫写错了键名（attemptId／incarnationId），真实回执用 attempt／incarnation。
// RFC-034 v2（0017 断代）之后部署顺序是先迁移再起新代码，当前代码不再面对 0014 的表集合；所以这里先在 0014
// 的旧库上留下原数据（旧守卫放行的真实改写也做一次再改回），完整升级到当前版本后：原执行与回执逐字保留，
// 用当前代码确认并封写项目删除，此后对尝试或实例的替换被拒绝，清理照常停止。
import { describe, expect, test } from 'bun:test';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { runMigrations } from '@crewstation/persistence';
import { jsonHash } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { sessionMigrations } from '../../wiring';
import { sessionProjectWork } from '../../adapters/persistence/deletion/projectWork';
import { cleanupFixture } from './cleanupFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('original business binding migration (real PG old database upgrade)', () => {
  test('0014 data and receipts survive the full upgrade, then a sealed deletion forbids real attempt/incarnation replacements', async () => {
    const original = { ...sessionMigrations, files: sessionMigrations.files.filter((file) => file.name < '0015') };
    const f = await cleanupFixture(original), work = sessionProjectWork(f.database.db, f.source);
    try {
      const replace = (receipt: typeof f.receipt) => f.database.db.execute(sql`UPDATE session.business_executions SET receipt=${JSON.stringify(receipt)}::jsonb WHERE task_id=${f.task}`);
      // The old column names allowed this actual mutation; no empty-schema-only upgrade assertion.
      await replace({ ...f.receipt, attempt: 2 }); expect((await f.business.get(f.task, f.receipt.executionId))?.receipt.attempt).toBe(2);
      await replace(f.receipt);
      const before = await f.database.db.execute(sql`SELECT to_jsonb(e) AS body FROM session.business_executions e ORDER BY task_id, execution_id`);
      await runMigrations(f.database.db, [sessionMigrations]);
      expect(await f.database.db.execute(sql`SELECT name FROM platform_infra.migrations WHERE module=${sessionMigrations.module}`)).toHaveLength(sessionMigrations.files.length);
      expect(await f.database.db.execute(sql`SELECT to_jsonb(e) AS body FROM session.business_executions e ORDER BY task_id, execution_id`)).toEqual(before);
      expect((await f.business.get(f.task, f.receipt.executionId))?.receipt).toEqual(f.receipt);

      const context: ProjectDeletionContext = { operationId: f.operationId, generation: 1, target: f.target, phase: 'seal', confirmed: await f.owner.inspect(f.target) };
      expect(context.confirmed).toMatchObject({ complete: true, blockers: [] });
      expect((await f.owner.run(context)).kind).toBe('done'); f.deleting();
      const stop: ProjectDeletionContext = { ...context, phase: 'stop' };
      const write = (receipt: typeof f.receipt) => work.runGranted(stop,
        { taskKey: f.task, kind: 'cleanup', reference: f.commandId(), inputDigest: jsonHash(receipt) },
        () => work.database.execute(sql`UPDATE session.business_executions SET receipt=${JSON.stringify(receipt)}::jsonb WHERE task_id=${f.task}`));
      await expect(write({ ...f.receipt, attempt: 2 })).rejects.toThrow();
      await expect(write({ ...f.receipt, incarnation: crypto.randomUUID() })).rejects.toThrow();
      expect((await f.business.get(f.task, f.receipt.executionId))?.receipt).toEqual(f.receipt);
      expect((await f.owner.run(stop)).kind).toBe('done');
    } finally { await work.drain(); await f.drop(); }
  }, 30_000);
});
