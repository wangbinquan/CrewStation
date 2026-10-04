import { describe, expect, test } from 'bun:test';
import { runMigrations } from '@crewstation/persistence';
import { jsonHash } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { sessionMigrations } from '../../wiring';
import { sessionProjectWork } from '../../adapters/persistence/deletion/projectWork';
import { cleanupFixture } from './cleanupFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('original business binding migration (real PG old sealed database upgrade)', () => {
  test('0014 data and receipts survive the append-only repair while real attempt/incarnation replacements become forbidden', async () => {
    const original = { ...sessionMigrations, files: sessionMigrations.files.filter((file) => file.name < '0015') };
    const f = await cleanupFixture(original), work = sessionProjectWork(f.database.db, f.source);
    try {
      expect((await f.owner.run({ ...f.context, phase: 'seal' })).kind).toBe('done'); f.deleting();
      const write = (receipt: typeof f.receipt) => work.runGranted(f.context,
        { taskKey: f.task, kind: 'cleanup', reference: f.commandId(), inputDigest: jsonHash(receipt) },
        () => work.database.execute(sql`UPDATE session.business_executions SET receipt=${JSON.stringify(receipt)}::jsonb WHERE task_id=${f.task}`));
      // The old column names allowed this actual mutation; no empty-schema-only upgrade assertion.
      await write({ ...f.receipt, attempt: 2 }); expect((await f.business.get(f.task, f.receipt.executionId))?.receipt.attempt).toBe(2);
      await write(f.receipt);
      const before = await f.database.db.execute('SELECT body,phases FROM session.project_deletions');
      await runMigrations(f.database.db, [sessionMigrations]);
      expect(await f.database.db.execute('SELECT body,phases FROM session.project_deletions')).toEqual(before);
      expect((await f.business.get(f.task, f.receipt.executionId))?.receipt).toEqual(f.receipt);
      await expect(write({ ...f.receipt, attempt: 2 })).rejects.toThrow();
      await expect(write({ ...f.receipt, incarnation: crypto.randomUUID() })).rejects.toThrow();
      expect(await f.database.db.execute(sql`SELECT name FROM platform_infra.migrations WHERE module=${sessionMigrations.module}`)).toHaveLength(sessionMigrations.files.length);
      expect((await f.owner.run(f.context)).kind).toBe('done');
    } finally { await work.drain(); await f.drop(); }
  });
});
