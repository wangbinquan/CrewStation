// RFC-034: a global scan is registered control state, never one project's content.
import { afterEach, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { resourcesMigrations } from '../wiring';
import { deletionControls } from './deletionFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('project deletion preserves global maintenance scan control (real PG)', () => {
  let database: TestDatabase;
  afterEach(async () => { await database?.drop(); });
  test('delete one project without deleting either global cursor or allowing an unknown content table', async () => {
    database = await createTestDatabase([resourcesMigrations]);
    await database.db.execute(sql`INSERT INTO resources.maintenance_sweeps(step,scan_cutoff,after_id,epoch,lease_holder,lease_until,fencing_token)
      VALUES ('retention',clock_timestamp(),'original-retention',4,'active-retention',clock_timestamp()+interval '1 minute',7),
        ('compaction',clock_timestamp(),'original-compaction',5,'active-compaction',clock_timestamp()+interval '1 minute',8)`);
    const before = await database.db.execute(sql`SELECT to_jsonb(s) AS body FROM resources.maintenance_sweeps s ORDER BY step`);
    const fixture = deletionControls(database); await fixture.plan();
    for (const phase of ['seal', 'stop', 'purge', 'prove', 'metadata', 'verify'] as const) expect((await fixture.run(phase)).kind).toBe('done');
    expect(await database.db.execute(sql`SELECT to_jsonb(s) AS body FROM resources.maintenance_sweeps s ORDER BY step`)).toEqual(before);
    await database.db.execute(sql`CREATE TABLE resources.future_materials(id text PRIMARY KEY)`);
    await expect(fixture.plan()).rejects.toThrow('未登记');
  });
});
