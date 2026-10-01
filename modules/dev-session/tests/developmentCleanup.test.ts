// RFC-034: irreversible original owner/ending and actual Session re-read boundaries, not whole-chain acceptance.
import { afterEach, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { ProjectIdSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { devSessionMigrations } from '../wiring';
import { developmentCleanupFixture } from './developmentCleanupFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-034 owner-private bound cleanup participant', () => {
  let db: TestDatabase;
  afterEach(async () => { await db?.drop(); });
  const setup = async (bound = true) => { db = await createTestDatabase([devSessionMigrations]); return developmentCleanupFixture(db.db, bound); };
  test('original ending persists first reason and CNY acceptance, and completed replay ignores consumer ACK progress', async () => {
    const f = await setup(); f.endingControl.sequence = 3; f.endingControl.copied = 3;
    const first = await f.participant.advance(f.input); expect(first.kind).toBe('permitted');
    if (first.kind !== 'permitted') throw new Error('missing expected digital permit');
    expect(first.evidence).toMatchObject({ registration: { runtimeTaskId: f.child.id }, owner: { priceBookRevision: 3, profileRevision: 2, firstReason: 'cancelled' }, closure: { persistedThrough: 3 } });
    const stored = f.stored.get(f.child.id)!; stored.offeredThrough = 3; stored.sourceAcknowledgedThrough = 2;
    f.controls.priceRevision = 99; f.endingControl.now = '2026-10-01T01:00:00.000Z';
    expect(await f.participant.advance(f.input)).toEqual(first); expect(f.calls.filter((c) => c.type === 'stopDevelopmentAgent')).toHaveLength(1);
    expect((await f.starts.findByExecution(f.child.id))?.state).toBe('ended');
    expect(JSON.stringify(first.evidence)).not.toContain('owner-private-prompt');
  });
  test('an evidence-complete ending cannot bypass the original persistent Session copy lookup', async () => {
    const f = await setup(); expect((await f.participant.advance(f.input)).kind).toBe('permitted');
    f.cleanupControl.missingCopy = true; expect(await f.participant.advance(f.input)).toEqual({ kind: 'waiting', reason: 'durable-copy' });
    f.cleanupControl.missingCopy = false;
    const copy = structuredClone(f.stored.get(f.child.id)!); copy.closure!.closedAt = '2026-10-01T00:00:00.000Z'; f.cleanupControl.copyOverride = copy;
    await expect(f.participant.advance(f.input)).rejects.toThrow('原 Session');
  });
  test('unbound and independent unknown stop keep the original owner and do not fabricate zero or a permit', async () => {
    const f = await setup(false); expect(await f.participant.advance(f.input)).toEqual({ kind: 'waiting', reason: 'unbound' });
    expect(await f.store.get(f.child.id)).toBeUndefined(); expect(f.calls).toEqual([]);
  });
  test('unknown stop and pending copy preserve ending for replay instead of using timeouts as loss', async () => {
    const f = await setup(); f.endingControl.stopState = 'unknown'; f.endingControl.closure = 'interrupted';
    expect((await f.participant.advance(f.input)).kind).toBe('waiting'); expect((await f.store.get(f.child.id))?.stop).toBeNull();
    expect((await f.owner.get(f.child.id))?.binding).not.toBeNull();
  });
  test('Pod, Agent, project and profile replacements reject before owner ending', async () => {
    const f = await setup();
    for (const input of [{ ...f.input, podUid: crypto.randomUUID() }, { ...f.input, profileRevision: 7 }, { ...f.input, identity: { ...f.input.identity, agentId: newResourceId() } }, { ...f.input, identity: { ...f.input.identity, projectId: ProjectIdSchema.parse(newResourceId()) } }]) {
      await expect(f.participant.advance(input)).rejects.toMatchObject({ kind: 'precondition' });
    }
    expect(await f.store.get(f.child.id)).toBeUndefined(); expect(f.calls).toEqual([]);
    f.child.native!.podUid = crypto.randomUUID(); f.envs.set(f.child.id, f.child);
    await expect(f.participant.advance(f.input)).rejects.toMatchObject({ kind: 'precondition' });
  });
  test('temporary stop/drain failures wait on the same original binding and subsequently resume', async () => {
    const f = await setup(); f.endingControl.stopFailure = true;
    expect((await f.participant.advance(f.input)).kind).toBe('waiting'); const binding = (await f.owner.get(f.child.id))!.binding;
    f.endingControl.stopFailure = false; f.endingControl.drainFailure = true; expect((await f.participant.advance(f.input)).kind).toBe('waiting');
    f.endingControl.drainFailure = false; expect((await f.participant.advance(f.input)).kind).toBe('permitted'); expect((await f.owner.get(f.child.id))!.binding).toEqual(binding);
  });
  test('public internal API is optional by default and explicit wiring uses the existing PG owner', async () => {
    const f = await setup(); expect(f.module(false).api.developmentCleanup).toBeUndefined();
    expect((await f.module(true).api.developmentCleanup!.advance(f.input)).kind).toBe('permitted');
  });
});
