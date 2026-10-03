import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { fixture, otherId, seed, target } from './projectDeletionFixture';

const available = await testDatabaseAvailable();
const databases: TestDatabase[] = [];
afterEach(async () => { for (const database of databases.splice(0)) await database.drop(); });
const count = async (database: TestDatabase) => (await database.db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM observability.usage_projections`))[0]!.count;
const row = (projectId: string, taskKey: string) => ({ meter_key: newResourceId(), task_key: taskKey, document: { identity: { projectId } } });
const insert = async (database: TestDatabase, rows: readonly Record<string, unknown>[]) => database.db.execute(sql`INSERT INTO observability.usage_projections SELECT * FROM jsonb_populate_recordset(NULL::observability.usage_projections,${JSON.stringify(rows)}::jsonb)`);

async function expectOriginalOwnershipRejection(database: TestDatabase, rows: readonly Record<string, unknown>[]) {
  let rejected: unknown;
  try { await insert(database, rows); } catch (error) { rejected = error instanceof Error ? error.cause ?? error : error; }
  expect(rejected).toMatchObject({ code: '55000', message: 'Observation content requires unambiguous original project ownership' });
}

describe.skipIf(!available)('original inserted observation project batches', () => {
  test('distinct valid projects and repeated references all remain in the original statement', async () => {
    const f = await fixture(); databases.push(f.database);
    const a = await seed(f.database, target.id), b = await seed(f.database, otherId);
    const rows = [row(target.id, a.taskKey), row(otherId, b.taskKey), row(target.id, a.taskKey)];
    await insert(f.database, rows);
    expect(await count(f.database)).toBe(5);
    const present = await f.database.db.execute<{ meter_key: string }>(sql`SELECT meter_key FROM observability.usage_projections WHERE meter_key=ANY(ARRAY[${sql.join(rows.map(value => sql`${value.meter_key}`), sql`, `)}]::text[]) ORDER BY meter_key`);
    expect(present.map(value => value.meter_key)).toEqual(rows.map(value => value.meter_key).sort());
  });
  test('one contradictory original reference rolls back the complete batch rather than merging it into valid owners', async () => {
    const f = await fixture(); databases.push(f.database);
    const a = await seed(f.database, target.id), b = await seed(f.database, otherId);
    const before = await count(f.database);
    await expectOriginalOwnershipRejection(f.database, [row(target.id, a.taskKey), row(otherId, b.taskKey), row(target.id, b.taskKey)]);
    expect(await count(f.database)).toBe(before);
    await insert(f.database, [row(target.id, a.taskKey)]);
    expect(await count(f.database)).toBe(before + 1);
  });
  test('one unknown original owner is preserved as an empty owner set and invalidates the whole statement', async () => {
    const f = await fixture(); databases.push(f.database);
    const a = await seed(f.database, target.id), before = await count(f.database);
    await expectOriginalOwnershipRejection(f.database, [row(target.id, a.taskKey), {meter_key: newResourceId(),task_key: newResourceId(),document: {}}]);
    expect(await count(f.database)).toBe(before);
  });
});
