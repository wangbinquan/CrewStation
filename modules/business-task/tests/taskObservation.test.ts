import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionCommandFixture } from './executionCommandFixture';
import { drizzleExecutionProjection } from '../adapters/persistence/execution/projection';
import { drizzleExecutionLifecycles } from '../adapters/persistence/execution/lifecycles';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 parent state observation log', () => {
  let db: TestDatabase;
  beforeAll(async () => { db = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await db?.drop(); });
  test('GET is read-only; background transitions are ordered and restart does not duplicate them', async () => {
    const f = await executionCommandFixture(db.db), projection = drizzleExecutionProjection(db.db);
    f.env.state = 'creating';
    await f.request(`/v3/business-tasks/${f.task.id}`);
    expect((await projection.events(f.serviceId, f.task.id, { limit: 100 })).items).toHaveLength(0);
    await f.module.api.v3.runOnce();
    f.env.state = 'running';
    await f.make().module.api.v3.runOnce();
    await f.make().module.api.v3.runOnce();
    f.env.state = 'released';
    await f.make().module.api.v3.runOnce();
    const events = await projection.events(f.serviceId, f.task.id, { limit: 100 });
    expect(events.items.map((e) => e.data)).toEqual([{ state: 'creating', generation: 1 }, { state: 'running', generation: 1 }, { state: 'closed', generation: 1 }]);
    f.env.state = 'running';
    await f.make().module.api.v3.runOnce();
    expect((await projection.events(f.serviceId, f.task.id, { limit: 100 })).items).toEqual(events.items);
  });
  test('an old running observation cannot append after a pause request or replace its generation', async () => {
    const f = await executionCommandFixture(db.db), projection = drizzleExecutionProjection(db.db);
    const candidate = (await projection.taskObservations()).find((c) => c.operation.intent.task.id === f.task.id)!;
    expect(candidate).toBeDefined();
    const lifecycle = drizzleExecutionLifecycles(db.db);
    await lifecycle.request(f.serviceId, f.task.id, 'pause', { requestKey: 'pause', expectedGeneration: 1, fence: f.fence }, 'running', {
      source: { releaseId: f.releaseId, physicalSlot: 'blue', podUid: 'pod-one', ready: true, role: 'prod' }, fence: f.fence,
    });
    expect(await projection.observeTask(candidate, 'running')).toBe(false);
    expect((await projection.events(f.serviceId, f.task.id, { limit: 100 })).items.map((e) => e.data)).toEqual([{ state: 'pausing', generation: 2 }]);
  });
});
