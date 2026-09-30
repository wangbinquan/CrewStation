// A stale ordinary AgentStart used to resurrect a digital execution after its owner ended.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { developmentEndingStore } from '../adapters/persistence/ending/store';
import { devSessionMigrations } from '../wiring';
import { developmentUsageFixture } from './developmentUsageFixture';

const available = await testDatabaseAvailable();
let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([devSessionMigrations]); });
afterAll(async () => { await database?.drop(); });

describe.skipIf(!available)('数字结束的原目标行保护', () => {
  test('late pending/dispatched snapshots cannot resurrect ending or clear its immutable owner', async () => {
    const f = await developmentUsageFixture(database.db), original = await f.owner.prepare(f.preparation), store = developmentEndingStore(database.db);
    await f.owner.bind(f.child.id, f.info);
    const binding = (await f.owner.get(f.child.id))!.binding;
    await store.request({ executionTaskId: f.child.id, expectedRegistration: binding, reason: 'cancelled', observedAt: '2026-09-30T00:20:00.000Z' });
    await f.starts.update({ ...f.start, state: 'pending', finalized: false, cursor: 7, failure: 'late diagnostic' });
    // The old full-row update clears ended, even though the digital owner is closed.
    expect(await f.starts.get(f.start.agentId)).toMatchObject({ state: 'ended', cursor: 7, failure: 'late diagnostic', finalized: false });
    await f.starts.update({ ...f.start, state: 'dispatched', finalized: true, cursor: 2, request: { prompt: 'stale replacement' }, endedAt: '2030-01-01T00:00:00.000Z' });
    const value = (await f.starts.get(f.start.agentId))!;
    expect(value).toMatchObject({ state: 'ended', cursor: 7, request: f.start.request, finalized: false, failure: 'late diagnostic' });
    expect(value.endedAt).toBeUndefined(); expect(Object.keys(value)).not.toContain('logicalEnding');
    expect((await f.owner.get(f.child.id))!.price).toEqual(original.price);
    expect((await f.owner.get(f.child.id))!.closeReason).toBe('cancelled');
    expect((await store.get(f.child.id))!.actualEndedAt).toBeNull();
  });
  test('legacy ordinary updates retain their prior behavior and omit all private ending state', async () => {
    const f = await developmentUsageFixture(database.db);
    await f.starts.update({ ...f.start, state: 'dispatched', cursor: 9 });
    await f.starts.update({ ...f.start, state: 'ended', finalized: true, cursor: 11, endedAt: '2026-09-30T00:30:00.000Z' });
    expect(await f.starts.get(f.start.agentId)).toEqual({ ...f.start, state: 'ended', finalized: true, cursor: 11, endedAt: '2026-09-30T00:30:00.000Z' });
    expect(await developmentEndingStore(database.db).get(f.child.id)).toBeUndefined();
  });
});
