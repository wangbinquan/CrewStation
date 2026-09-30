// RFC-034 owner preparation checkpoint. Real PG, synthetic owner environments; no real model or lifecycle acceptance.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { DevelopmentUsageReceipt, TaskId } from '@crewstation/contracts';
import { DevelopmentUsageReceiptSchema, TaskIdSchema } from '@crewstation/contracts';
import { newResourceId, PlatformError } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { developmentUsageOwner } from '../application/developmentUsage';
import { DevelopmentUsageOwnerRecordSchema, developmentOwnerIntentDigest } from '../domain/developmentUsage';
import { devSessionMigrations } from '../wiring';
import { developmentUsageFixture } from './developmentUsageFixture';

const available = await testDatabaseAvailable();
let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([devSessionMigrations]); });
afterAll(async () => { await database?.drop(); });

describe.skipIf(!available)('开发 owner 稳定意图与人民币原受理', () => {
  test('first accepted price and nonce survive retries, price changes, old AgentStart updates and another owner instance', async () => {
    const f = await developmentUsageFixture(database.db), original = await f.owner.prepare(f.preparation);
    expect(original.price).toMatchObject({ acceptedAt: '2026-09-30T00:10:01.000Z', priceBookRevision: 3, profile: { id: f.start.profile.profileId, revision: 2, protocol: 'opencode' } });
    expect(original.digestNonce).toMatch(/^[a-f0-9]{64}$/);
    expect(original.payloadDigest).toBe(developmentOwnerIntentDigest(original));
    f.controls.priceRevision = 99; f.controls.priceFailure = new Error('fresh prices must not be queried');
    await f.starts.update({ ...f.start, state: 'ended', cancelled: true, cursor: 42, finalized: true });
    const other = developmentUsageOwner(f.store, f.starts, { getEnvironment: async () => { throw new Error('do not borrow a current workspace'); } });
    expect(await other.prepare(f.preparation)).toEqual(original); expect(await f.owner.get(f.start.execution.taskId)).toEqual(original); expect(f.controls.priceCalls).toBe(1);
    expect(await f.owner.get(newResourceId() as TaskId)).toBeUndefined();
    await expect(other.prepare({ ...f.preparation, intent: { ...f.preparation.intent, initialPrompt: 'changed' } })).rejects.toMatchObject({ kind: 'conflict' });
  });

  test('concurrent first preparations retain one committed nonce and never reprice a frozen empty catalog', async () => {
    const f = await developmentUsageFixture(database.db); f.controls.priceRevision = 0;
    const [a, b] = await Promise.all([f.owner.prepare(f.preparation), f.owner.prepare(f.preparation)]);
    expect(a).toEqual(b); expect(a.price.priceBookRevision).toBe(0);
    const candidate = { intent: a.intent, context: a.context, price: a.price, digestNonce: 'b'.repeat(64), payloadDigest: developmentOwnerIntentDigest({ intent: a.intent, digestNonce: 'b'.repeat(64) }) };
    expect(await f.store.prepare(candidate)).toEqual(a);
    await expect(f.store.prepare({ ...candidate, price: { ...candidate.price, priceBookRevision: 1 } })).rejects.toMatchObject({ kind: 'conflict' });
    expect((await f.owner.get(f.start.execution.taskId))?.price.priceBookRevision).toBe(0);
  });

  test('price failures, missing pricing and foreign price receipts leave no owner admission', async () => {
    const f = await developmentUsageFixture(database.db); f.controls.priceFailure = new PlatformError('unavailable', 'temporary price owner failure');
    await expect(f.owner.prepare(f.preparation)).rejects.toMatchObject({ kind: 'unavailable' }); expect(await f.store.get(f.start.execution.taskId)).toBeUndefined();
    const missing = developmentUsageOwner(f.store, f.starts, f.environmentPort);
    await expect(missing.prepare(f.preparation)).rejects.toMatchObject({ kind: 'precondition' });
    f.controls.priceFailure = undefined; f.controls.badPrice = { identity: { ...f.preparation.intent.identity, taskId: TaskIdSchema.parse(newResourceId()) } };
    await expect(f.owner.prepare(f.preparation)).rejects.toThrow('人民币受理'); expect(await f.store.get(f.start.execution.taskId)).toBeUndefined();
    f.controls.badPrice = { profile: { id: f.start.profile.profileId, revision: 20, protocol: 'opencode' } };
    await expect(f.owner.prepare(f.preparation)).rejects.toThrow('人民币受理');
  });

  test('cancellation committed during price acceptance cannot produce a later first owner admission', async () => {
    const f = await developmentUsageFixture(database.db);
    const owner = developmentUsageOwner(f.store, f.starts, f.environmentPort, { accept: async (input) => {
      const price = await f.pricing.accept(input); await f.starts.update({ ...f.start, state: 'ended', cancelled: true }); return price;
    } });
    await expect(owner.prepare(f.preparation)).rejects.toMatchObject({ kind: 'precondition' }); expect(await f.store.get(f.child.id)).toBeUndefined();
    const cancelled = await developmentUsageFixture(database.db);
    const duringPrice = developmentUsageOwner(cancelled.store, cancelled.starts, cancelled.environmentPort, { accept: async (input) => {
      const price = await cancelled.pricing.accept(input); await cancelled.starts.update({ ...cancelled.start, cancelled: true }); return price;
    } });
    await expect(duringPrice.prepare(cancelled.preparation)).rejects.toMatchObject({ kind: 'precondition' }); expect(await cancelled.store.get(cancelled.child.id)).toBeUndefined();
    await expect(cancelled.owner.prepare(cancelled.preparation)).rejects.toMatchObject({ kind: 'precondition' }); expect(cancelled.controls.priceCalls).toBe(1);
  });

  test('real Agent owner identity/request/profile and pre-dispatch state are required before pricing', async () => {
    const f = await developmentUsageFixture(database.db), intent = f.preparation.intent;
    for (const patch of [
      { identity: { ...intent.identity, agentId: newResourceId() } }, { identity: { ...intent.identity, taskId: TaskIdSchema.parse(newResourceId()) } },
      { profileRevision: 8 }, { profileId: newResourceId() }, { permission: 'edit' as const }, { mode: 'oneshot' as const },
      { initialPrompt: 'changed' }, { cwd: '/other' }, { resumeSessionId: null }, { systemPrompt: 'not accepted' },
    ]) await expect(f.owner.prepare({ ...f.preparation, intent: { ...intent, ...patch } })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.owner.prepare({ ...f.preparation, intent: { ...intent, identity: { ...intent.identity, executionId: newResourceId() } } })).rejects.toMatchObject({ kind: 'not_found' });
    await f.starts.update({ ...f.start, state: 'dispatched' }); await expect(f.owner.prepare(f.preparation)).rejects.toMatchObject({ kind: 'precondition' });
    expect(f.controls.priceCalls).toBe(0);
  });

  test('actual parent project, service, trace and branch are required, not caller-selected context', async () => {
    const f = await developmentUsageFixture(database.db);
    for (const patch of [{ projectId: newResourceId() }, { serviceId: newResourceId() }, { traceId: 'b'.repeat(32) }, { branch: 'other' }, { native: f.child.native }]) {
      f.envs.set(f.workspace.id, { ...f.workspace, ...patch } as typeof f.workspace);
      await expect(f.owner.prepare(f.preparation)).rejects.toMatchObject({ kind: 'conflict' });
    }
    f.envs.delete(f.workspace.id); await expect(f.owner.prepare(f.preparation)).rejects.toMatchObject({ kind: 'conflict' }); expect(f.controls.priceCalls).toBe(0);
  });

  test('binding verifies actual child Pod and immutable journal, resolves only the exact original key and excludes private intent', async () => {
    const f = await developmentUsageFixture(database.db); await f.owner.prepare(f.preparation);
    await expect(f.owner.bind(f.child.id, { ...f.info, podUid: 'parent-pod' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.owner.bind(f.child.id, { ...f.info, runtimeTaskId: f.workspace.id })).rejects.toMatchObject({ kind: 'conflict' });
    f.envs.set(f.child.id, { ...f.child, native: { ...f.child.native!, podUid: undefined } });
    await expect(f.owner.bind(f.child.id, f.info)).rejects.toMatchObject({ kind: 'conflict' }); f.envs.set(f.child.id, f.child);
    const bound = await f.owner.bind(f.child.id, f.info), key = bound.binding!.key;
    expect(await f.owner.bind(f.child.id, f.info)).toEqual(bound);
    expect(await f.owner.resolve(key)).toEqual({ registration: bound.binding!, price: bound.price });
    expect(JSON.stringify(await f.owner.resolve(key))).not.toContain('owner-private-prompt'); expect(JSON.stringify(await f.owner.resolve(key))).not.toContain('digestNonce');
    expect(await f.owner.resolve({ ...key, payloadDigest: 'f'.repeat(64) })).toBeUndefined();
    expect(await f.owner.resolve({ ...key, executionId: newResourceId() })).toBeUndefined();
    for (const patch of [{ journalId: crypto.randomUUID() }, { incarnation: crypto.randomUUID() }]) await expect(f.owner.bind(f.child.id, { ...f.info, ...patch })).rejects.toMatchObject({ kind: 'conflict' });
    f.envs.set(f.child.id, { ...f.child, native: { ...f.child.native!, podUid: 'replaced-pod' } });
    await expect(f.owner.bind(f.child.id, { ...f.info, podUid: 'replaced-pod' })).rejects.toMatchObject({ kind: 'conflict' }); expect(await f.owner.get(f.child.id)).toEqual(bound);
  });

  test('consumer resolves only the originally selected native source without private intent or current configuration', async () => {
    const f = await developmentUsageFixture(database.db);
    const preparation = { ...f.preparation, intent: { ...f.preparation.intent, nativeSource: { version: 1 as const } } };
    const prepared = await f.owner.prepare(preparation), bound = await f.owner.bind(f.child.id, f.info);
    const expected = { registration: bound.binding!, price: prepared.price,
      nativeSelection: { version: 1 as const, expectedNamespace: preparation.intent.nativeUsageLineageKey } };
    // A consumer must verify the frozen choice before trusting any Runner source frame.
    expect(await f.owner.resolve(bound.binding!.key)).toEqual(expected);
    f.controls.priceRevision = 99;
    f.controls.priceFailure = new Error('do not reprice an old execution');
    const restored = developmentUsageOwner(f.store, f.starts, { getEnvironment: async () => { throw new Error('do not borrow current workspace or capabilities'); } });
    await restored.close(f.child.id, 'workspace-released');
    const resolved = await restored.resolve(bound.binding!.key);
    expect(resolved).toEqual(expected); expect(f.controls.priceCalls).toBe(1);
    expect(Object.keys(resolved!).sort()).toEqual(['nativeSelection', 'price', 'registration']);
    for (const secret of [prepared.digestNonce, 'owner-private-prompt', '/usr/local/bin/opencode', 'http://platform.example.test/']) expect(JSON.stringify(resolved)).not.toContain(secret);
    await expect(restored.prepare(f.preparation)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(restored.prepare({ ...preparation, intent: { ...preparation.intent, nativeUsageLineageKey: 'new-current-namespace' } })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await restored.resolve({ ...bound.binding!.key, incarnation: crypto.randomUUID() })).toBeUndefined();
    expect(await f.store.get(f.child.id)).toMatchObject({ intent: preparation.intent, price: prepared.price, payloadDigest: prepared.payloadDigest });
  });

  test('a new Runner incarnation can report its original receipt, but cannot substitute key, owner, Pod or revision', async () => {
    const f = await developmentUsageFixture(database.db); await f.owner.prepare(f.preparation); const bound = await f.owner.bind(f.child.id, f.info);
    const receipt: DevelopmentUsageReceipt = { key: bound.binding!.key, podUid: f.info.podUid, identity: f.preparation.intent.identity, profileId: f.preparation.intent.profileId, profileRevision: 2, phase: 'unknown', lastSequence: 0, acknowledgedSequence: 0, finalThrough: null, result: null, interruption: 'runner-restarted' };
    expect(await f.owner.bind(f.child.id, { ...f.info, incarnation: crypto.randomUUID(), receipt })).toEqual(bound);
    for (const changed of [{ ...receipt, key: { ...receipt.key, incarnation: crypto.randomUUID() } }, { ...receipt, podUid: 'other-pod' }, { ...receipt, identity: { ...receipt.identity, agentId: newResourceId() } }, { ...receipt, profileRevision: 3 }, { ...receipt, profileId: newResourceId() }])
      await expect(f.owner.bind(f.child.id, { ...f.info, receipt: changed })).rejects.toMatchObject({ kind: 'conflict' });
    const other = await developmentUsageFixture(database.db); const prepared = await other.owner.prepare(other.preparation);
    const stranger = DevelopmentUsageReceiptSchema.parse({ ...receipt, key: { ...receipt.key, executionId: other.child.id, payloadDigest: prepared.payloadDigest }, identity: other.preparation.intent.identity, podUid: other.info.podUid, profileId: other.preparation.intent.profileId });
    await expect(other.owner.bind(other.child.id, { ...other.info, receipt: stranger })).rejects.toMatchObject({ kind: 'conflict' }); expect((await other.owner.get(other.child.id))?.binding).toBeNull();
  });

  test('closed or unsupported admission cannot gain a new journal; closing never erases an already-bound source', async () => {
    const f = await developmentUsageFixture(database.db); await f.owner.prepare(f.preparation);
    expect((await f.owner.unsupported(f.child.id)).unsupported).toBe(true); expect((await f.owner.unsupported(f.child.id)).binding).toBeNull();
    await expect(f.owner.bind(f.child.id, f.info)).rejects.toMatchObject({ kind: 'precondition' });
    expect((await f.owner.close(f.child.id, 'cancelled')).closeReason).toBe('cancelled'); expect((await f.owner.close(f.child.id, 'forced-release')).closeReason).toBe('cancelled');
    await expect(f.owner.unsupported(f.child.id)).rejects.toMatchObject({ kind: 'precondition' });
    const b = await developmentUsageFixture(database.db); await b.owner.prepare(b.preparation); const bound = await b.owner.bind(b.child.id, b.info);
    await expect(b.owner.unsupported(b.child.id)).rejects.toMatchObject({ kind: 'precondition' });
    const closed = await b.owner.close(b.child.id, 'workspace-released'); expect(closed.binding).toEqual(bound.binding); expect(await b.owner.resolve(bound.binding!.key)).toEqual({ registration: bound.binding!, price: bound.price });
    const c = await developmentUsageFixture(database.db); await c.owner.prepare(c.preparation); await c.owner.close(c.child.id, 'error'); await expect(c.owner.bind(c.child.id, c.info)).rejects.toMatchObject({ kind: 'precondition' });
  });

  test('PG CAS serializes two journal bindings and preserves the winner against late ordinary owner writes', async () => {
    const f = await developmentUsageFixture(database.db); await f.owner.prepare(f.preparation);
    const results = await Promise.allSettled([f.owner.bind(f.child.id, f.info), f.owner.bind(f.child.id, { ...f.info, journalId: crypto.randomUUID() })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1); expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const winner = await f.owner.get(f.child.id); await f.starts.update({ ...f.start, state: 'ended', finalized: true }); expect(await f.owner.get(f.child.id)).toEqual(winner);
    await expect(f.store.bind(f.child.id, { ...winner!.binding!, profileRevision: 99 })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.store.bind(newResourceId() as TaskId, winner!.binding!)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(f.owner.bind(newResourceId() as TaskId, f.info)).rejects.toMatchObject({ kind: 'not_found' });
    expect(() => DevelopmentUsageOwnerRecordSchema.parse({ ...winner, payloadDigest: '0'.repeat(64) })).toThrow('稳定摘要');
    expect(() => DevelopmentUsageOwnerRecordSchema.parse({ ...winner, unsupported: true })).toThrow('原 journal');
  });
});
