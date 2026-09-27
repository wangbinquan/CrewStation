import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { BusinessEventPage, BusinessOperationDto } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionCommandFixture } from './executionCommandFixture';
import { drizzleExecutionProjection } from '../adapters/persistence/execution/projection';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 lifecycle event history and retention tombstones', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  test('close publishes durable state changes, waits for cleanup, and only expires seven days after confirmation', async () => {
    const f = await executionCommandFixture(tdb.db), path = `/v3/business-tasks/${f.task.id}`;
    let releases = 0;
    f.environmentPort.releaseEnvironment = async () => { releases++; f.env.state = 'releasing'; return f.env; };
    const input = { requestKey: 'close', expectedGeneration: 1, fence: f.fence };
    const operation = await (await f.request(`${path}/close`, input)).json() as BusinessOperationDto;
    expect(operation.state).toBe('pending'); expect(releases).toBe(1);
    expect(await (await f.request(path)).json()).toMatchObject({ state: 'closing', generation: 2, quotaHeld: true });
    const first = await (await f.request(`${path}/events`)).json() as BusinessEventPage;
    expect(first.items).toHaveLength(1); expect(first.items[0]).toMatchObject({ type: 'task-state', data: { state: 'closing', generation: 2 } });
    const projection = drizzleExecutionProjection(tdb.db);
    await tdb.db.execute(sql`UPDATE business_task.execution_events SET created_at=now()-interval '30 days' WHERE task_id=${f.task.id}`);
    expect(await projection.expire()).toBe(0); // Age alone cannot truncate active cleanup.
    f.env.state = 'released'; f.env.connected = false;
    for (let i = 0; i < 5; i++) await f.make().module.api.v3.runOnce();
    expect(await (await f.request(`${path}/operations/${operation.operationId}`)).json()).toMatchObject({ state: 'succeeded' });
    expect(await (await f.request(path)).json()).toMatchObject({ state: 'closed', generation: 2, quotaHeld: false });
    expect(await projection.expire()).toBe(0);
    const history = await (await f.request(`${path}/events`)).json() as BusinessEventPage;
    expect(history.items).toHaveLength(2); expect(history.items[1]).toMatchObject({ type: 'task-state', data: { state: 'closed', generation: 2 } });
    await tdb.db.execute(sql`UPDATE business_task.execution_logs SET closed_at=now()-interval '8 days' WHERE task_id=${f.task.id}`);
    expect(await projection.expire()).toBe(2);
    const expired = await f.request(`${path}/events?after=${history.nextCursor}`); expect(expired.status).toBe(410);
    const error = await expired.json(); expect(error.details).toMatchObject({ code: 'cursor_expired', snapshotUrl: path });
    expect((await f.request(`${path}/events`)).status).toBe(410);
    expect((await f.request(`${path}/events/stream`, undefined, 'trusted', { 'last-event-id': history.nextCursor! })).status).toBe(410);
    expect(await (await f.request(`${path}/events?after=${error.details.earliestCursor}`)).json()).toEqual({ items: [], nextCursor: error.details.earliestCursor, hasMore: false });
    expect((await f.request(`${path}/close`, input)).status).toBe(202); expect(releases).toBe(1);
    expect((await f.request(`${path}/close`, { ...input, requestKey: 'new', expectedGeneration: 2 })).status).toBe(409);
    expect(await projection.expire()).toBe(0);
    const other = await executionCommandFixture(tdb.db);
    expect((await other.request(`${path}/operations/${operation.operationId}`)).status).toBe(404);
  });
});
