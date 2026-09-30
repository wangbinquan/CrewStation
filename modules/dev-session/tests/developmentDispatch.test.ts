// RFC-034 original-key participant only. Real owner PG; synthetic Session/Runner transport, no real model or cleanup acceptance.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import type { TaskId } from '@crewstation/contracts';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { dispatchDevelopmentAgent } from '../application/development/dispatch';
import { developmentUsageOwner } from '../application/developmentUsage';
import { devSessionMigrations } from '../wiring';
import { developmentDispatchFixture } from './developmentDispatchFixture';

const available = await testDatabaseAvailable();
let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([devSessionMigrations]); });
afterAll(async () => { await database?.drop(); });

describe.skipIf(!available)('开发原键派发 participant', () => {
  test('bind and Session registration precede start; ACK loss and owner reload never acquire fresh material or reprice', async () => {
    const f = await developmentDispatchFixture(database.db); f.control.lostStartAck = true;
    expect((await dispatchDevelopmentAgent(f.deps, f.child.id)).kind).toBe('accepted');
    const original = (await f.owner.get(f.child.id))!, command = f.startsSent()[0]!;
    expect(command.type).toBe('startAgent');
    if (command.type !== 'startAgent') throw new Error('wrong command');
    expect(command.developmentUsage).toEqual({ intent: original.intent, key: original.binding!.key, digestNonce: original.digestNonce });
    expect(f.registrations[0]).toEqual(original.binding!); expect(f.control.materialCalls).toBe(1);
    f.controls.priceRevision = 99; f.controls.priceFailure = new Error('do not reprice');
    const owner = developmentUsageOwner(f.store, f.starts, { getEnvironment: async () => { throw new Error('do not use current workspace'); } });
    expect((await dispatchDevelopmentAgent({ ...f.deps, owner }, f.child.id)).kind).toBe('accepted');
    expect(f.startsSent()).toHaveLength(1); expect(f.control.materialCalls).toBe(1); expect(f.controls.priceCalls).toBe(1);
    expect(await owner.get(f.child.id)).toEqual(original);
    expect(JSON.stringify(original)).not.toContain('synthetic-secret');
  });

  test('registration failure after durable bind retries only that key before acquiring material', async () => {
    const f = await developmentDispatchFixture(database.db); f.control.registerFailure = true;
    expect(await dispatchDevelopmentAgent(f.deps, f.child.id)).toEqual({ kind: 'waiting', reason: 'retry' });
    const original = (await f.owner.get(f.child.id))!;
    expect(original.binding).not.toBeNull(); expect(f.startsSent()).toHaveLength(0); expect(f.control.materialCalls).toBe(0);
    f.control.registerFailure = false;
    expect((await dispatchDevelopmentAgent(f.deps, f.child.id)).kind).toBe('accepted');
    expect((await f.owner.get(f.child.id))?.binding).toEqual(original.binding); expect(f.controls.priceCalls).toBe(1);
    expect(f.registrations.every((r) => JSON.stringify(r) === JSON.stringify(original.binding))).toBe(true);
  });

  test('persistent finished survives lost ordinary terminal, finalized Agent and same-Pod Runner restart', async () => {
    const f = await developmentDispatchFixture(database.db, { bound: true });
    const finished = await f.setReceipt({ phase: 'finished', result: 'completed', interruption: 'runner-restarted' }, true);
    await f.starts.update({ ...f.start, state: 'ended', finalized: true });
    f.control.info.incarnation = crypto.randomUUID(); f.control.infoFailure = true; f.control.capabilities = undefined;
    const owner = developmentUsageOwner(f.store, f.starts, { getEnvironment: async () => { throw new Error('no current owner material'); } });
    for (let i = 0; i < 2; i++) expect(await dispatchDevelopmentAgent({ ...f.deps, owner }, f.child.id)).toEqual({ kind: 'terminal', receipt: finished, actualEndedAt: null });
    expect(f.control.materialCalls).toBe(0); expect(f.calls).toHaveLength(0); expect(f.startsSent()).toHaveLength(0);
    expect((await f.starts.get(f.start.agentId))?.endedAt).toBeUndefined(); // Recovery time is never an invented actual duration.
  });

  test('old selections and explicit missing capabilities stay legacy; unknown connection or advertised failures stay pending', async () => {
    const old = await developmentDispatchFixture(database.db, { selected: false });
    expect(await dispatchDevelopmentAgent(old.deps, old.child.id)).toEqual({ kind: 'legacy', reason: 'unselected' });
    expect(old.calls).toHaveLength(0); expect(old.control.materialCalls).toBe(0);
    const unsupported = await developmentDispatchFixture(database.db); unsupported.control.capabilities = { protocols: ['opencode'], pty: true, preview: false };
    expect(await dispatchDevelopmentAgent(unsupported.deps, unsupported.child.id)).toEqual({ kind: 'legacy', reason: 'unsupported' });
    expect(await dispatchDevelopmentAgent(unsupported.deps, unsupported.child.id)).toEqual({ kind: 'legacy', reason: 'unsupported' });
    expect((await unsupported.owner.get(unsupported.child.id))?.unsupported).toBe(true); expect(unsupported.calls).toHaveLength(0);
    for (const reason of ['disconnected', 'unknown-capabilities', 'source-unavailable'] as const) {
      const f = await developmentDispatchFixture(database.db);
      if (reason === 'disconnected') f.control.connected = false;
      if (reason === 'unknown-capabilities') f.control.capabilities = undefined;
      if (reason === 'source-unavailable') f.control.infoFailure = true;
      expect(await dispatchDevelopmentAgent(f.deps, f.child.id)).toEqual({ kind: 'waiting', reason });
      expect((await f.owner.get(f.child.id))?.unsupported).toBe(false); expect(f.control.materialCalls).toBe(0); expect(f.startsSent()).toHaveLength(0);
    }
  });

  test('advertised support is durable before info: restart capability loss cannot grant legacy fallback', async () => {
    const f = await developmentDispatchFixture(database.db); f.control.infoFailure = true;
    expect(await dispatchDevelopmentAgent(f.deps, f.child.id)).toEqual({ kind: 'waiting', reason: 'source-unavailable' });
    const owner = developmentUsageOwner(f.store, f.starts, f.environmentPort);
    f.control.capabilities = { protocols: ['opencode'], pty: true, preview: false };
    expect(await dispatchDevelopmentAgent({ ...f.deps, owner }, f.child.id)).toEqual({ kind: 'waiting', reason: 'source-unavailable' });
    expect((await owner.get(f.child.id))?.unsupported).toBe(false);
    expect(f.startsSent()).toHaveLength(0); expect(f.control.materialCalls).toBe(0);
  });

  test('support CAS freezes the actual original Pod and leaves old payloads unchanged until observed', async () => {
    const f = await developmentDispatchFixture(database.db), original = (await f.owner.get(f.child.id))!;
    expect(Object.hasOwn(original, 'capabilityPodUid')).toBe(false);
    const observed = await f.owner.observeSupported(f.child.id);
    expect(observed.capabilityPodUid).toBe(f.info.podUid);
    expect(observed.price).toEqual(original.price); expect(observed.digestNonce).toBe(original.digestNonce);
    const reloaded = developmentUsageOwner(f.store, f.starts, f.environmentPort);
    expect(await reloaded.observeSupported(f.child.id)).toEqual(observed);
    await expect(reloaded.unsupported(f.child.id)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.store.observeSupported(f.child.id, 'replacement-pod')).rejects.toMatchObject({ kind: 'conflict' });
    f.envs.set(f.child.id, { ...f.child, native: { ...f.child.native!, podUid: 'replacement-pod' } });
    await expect(reloaded.observeSupported(f.child.id)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(reloaded.bind(f.child.id, { ...f.info, podUid: 'replacement-pod' })).rejects.toMatchObject({ kind: 'conflict' });
    expect((await reloaded.get(f.child.id))?.binding).toBeNull();
    await reloaded.close(f.child.id, 'cancelled');
    await expect(f.store.observeSupported(f.child.id, f.info.podUid)).rejects.toMatchObject({ kind: 'precondition' });
    const legacy = await developmentDispatchFixture(database.db); await legacy.owner.unsupported(legacy.child.id);
    await expect(legacy.owner.observeSupported(legacy.child.id)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(legacy.owner.observeSupported(newResourceId() as TaskId)).rejects.toMatchObject({ kind: 'not_found' });
    const bad = await developmentDispatchFixture(database.db); bad.envs.delete(bad.child.id);
    await expect(bad.owner.observeSupported(bad.child.id)).rejects.toMatchObject({ kind: 'conflict' });
    expect(Object.hasOwn((await bad.owner.get(bad.child.id))!, 'capabilityPodUid')).toBe(false);
  });

  test('a delayed missing-capability response cannot overwrite concurrently persisted support', async () => {
    const f = await developmentDispatchFixture(database.db); f.control.infoFailure = true;
    let notify!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { notify = resolve; }), delayed = new Promise<void>((resolve) => { release = resolve; });
    const session = { ...f.session, connectionStatus: async () => { notify(); await delayed; return { connected: true, capabilities: { protocols: ['opencode' as const], pty: true, preview: false } }; } };
    const missing = dispatchDevelopmentAgent({ ...f.deps, session }, f.child.id);
    await entered;
    const supported = await dispatchDevelopmentAgent(f.deps, f.child.id);
    release();
    expect(supported.kind).toBe('waiting'); expect((await missing).kind).toBe('waiting');
    expect((await f.owner.get(f.child.id))?.unsupported).toBe(false); expect(f.startsSent()).toHaveLength(0);
  });

  test('an unrelated or corrupt journal cannot bind; original Pod replacement or unknown receipt cannot restart', async () => {
    const wrong = await developmentDispatchFixture(database.db); wrong.control.info.podUid = 'replacement';
    expect((await dispatchDevelopmentAgent(wrong.deps, wrong.child.id)).kind).toBe('waiting');
    expect((await wrong.owner.get(wrong.child.id))?.binding).toBeNull(); expect(wrong.registrations).toHaveLength(0);
    const foreign = await developmentDispatchFixture(database.db); foreign.control.info.runtimeTaskId = newResourceId() as TaskId;
    expect(await dispatchDevelopmentAgent(foreign.deps, foreign.child.id)).toEqual({ kind: 'waiting', reason: 'source-conflict' });
    const f = await developmentDispatchFixture(database.db, { bound: true });
    await f.setReceipt({ phase: 'unknown', interruption: 'runner-restarted' });
    expect(await dispatchDevelopmentAgent(f.deps, f.child.id)).toEqual({ kind: 'waiting', reason: 'source-unavailable' });
    f.control.info.receipt = null; f.control.info.incarnation = crypto.randomUUID();
    expect(await dispatchDevelopmentAgent(f.deps, f.child.id)).toEqual({ kind: 'waiting', reason: 'source-conflict' });
    f.control.infoFailure = true;
    expect(await dispatchDevelopmentAgent(f.deps, f.child.id)).toEqual({ kind: 'waiting', reason: 'source-unavailable' });
    expect(f.control.materialCalls).toBe(0); expect(f.startsSent()).toHaveLength(0);
  });

  test('Session registration and monotonic receipts are independently checked, including malformed transport', async () => {
    const f = await developmentDispatchFixture(database.db, { bound: true }), original = (await f.owner.get(f.child.id))!;
    await f.session.registerDevelopmentUsage(original.binding!);
    f.control.badStored = { ...f.stored.get(f.child.id), registration: { ...original.binding, podUid: 'other-pod' } };
    expect(await dispatchDevelopmentAgent(f.deps, f.child.id)).toEqual({ kind: 'waiting', reason: 'session-conflict' });
    f.control.badStored = { invalid: true };
    expect(await dispatchDevelopmentAgent(f.deps, f.child.id)).toEqual({ kind: 'waiting', reason: 'session-conflict' });
    f.control.badStored = undefined;
    await f.setReceipt({}, true); f.control.info.receipt = null;
    expect(await dispatchDevelopmentAgent(f.deps, f.child.id)).toEqual({ kind: 'waiting', reason: 'receipt-regressed' });
    expect(f.startsSent()).toHaveLength(0); expect(f.control.materialCalls).toBe(0);
  });

  test('closed owner, Session drain and cancellation during material prevent a delayed start', async () => {
    const closed = await developmentDispatchFixture(database.db, { bound: true }); await closed.owner.close(closed.child.id, 'cancelled');
    expect(await dispatchDevelopmentAgent(closed.deps, closed.child.id)).toEqual({ kind: 'ending', reason: 'cancelled' });
    expect(closed.calls).toHaveLength(0); expect(closed.control.materialCalls).toBe(0);
    const cancelled = await developmentDispatchFixture(database.db, { bound: true });
    cancelled.control.onMaterial = async () => { await cancelled.owner.close(cancelled.child.id, 'cancelled'); };
    expect(await dispatchDevelopmentAgent(cancelled.deps, cancelled.child.id)).toEqual({ kind: 'ending', reason: 'cancelled' });
    expect(cancelled.startsSent()).toHaveLength(0);
    const drained = await developmentDispatchFixture(database.db, { bound: true });
    drained.control.onMaterial = async () => { drained.stored.get(drained.child.id)!.drainReason = 'workspace-released'; };
    expect(await dispatchDevelopmentAgent(drained.deps, drained.child.id)).toEqual({ kind: 'ending', reason: 'workspace-released' });
    expect(drained.startsSent()).toHaveLength(0);
  });

  test('late acceptance while material is acquired wins; mismatched prompt or payload never gets sent', async () => {
    const late = await developmentDispatchFixture(database.db, { bound: true }); late.control.onMaterial = async () => { await late.setReceipt(); };
    expect((await dispatchDevelopmentAgent(late.deps, late.child.id)).kind).toBe('accepted'); expect(late.startsSent()).toHaveLength(0);
    const wrong = await developmentDispatchFixture(database.db, { bound: true });
    const deps = { ...wrong.deps, material: async (original: Parameters<typeof wrong.deps.material>[0]) => ({ ...wrong.makeCommand(original), initialPrompt: 'current prompt' }) };
    expect(await dispatchDevelopmentAgent(deps, wrong.child.id)).toEqual({ kind: 'waiting', reason: 'command-conflict' }); expect(wrong.startsSent()).toHaveLength(0);
  });

  test('successful transport ACK without a durable acceptance remains pending; owner read faults never fall back', async () => {
    const empty = await developmentDispatchFixture(database.db, { bound: true }); empty.control.holdEmpty = true;
    expect(await dispatchDevelopmentAgent(empty.deps, empty.child.id)).toEqual({ kind: 'waiting', reason: 'awaiting-receipt' });
    expect(empty.startsSent()).toHaveLength(1);
    const f = await developmentDispatchFixture(database.db), owner = { ...f.owner, get: async () => { throw new Error('PG retry'); } };
    expect(await dispatchDevelopmentAgent({ ...f.deps, owner }, f.child.id)).toEqual({ kind: 'waiting', reason: 'retry' });
    expect(f.calls).toHaveLength(0); expect(f.control.materialCalls).toBe(0);
  });
});
