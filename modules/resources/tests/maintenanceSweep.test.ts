import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { newResourceId } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import type { LedgerUnitOfWork } from '../ports/repositories';
import { expireRetention, compactStopped } from '../application/maintenance';
import { drizzleLedgerUnitOfWork } from '../adapters/persistence/drizzleLedger';
import type { Harness } from './fixtures';
import { createHarness, PROJECT } from './fixtures';

const available = await testDatabaseAvailable();
const pause = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
describe.skipIf(!available)('durable maintenance keyset and database-time fencing', () => {
  let h: Harness;
  afterEach(async () => { await h?.database.drop(); });
  async function fixture() {
    h = await createHarness();
    const [row] = await h.database.db.execute(sql`select clock_timestamp()::text as at`);
    h.clock.set(new Date(String(row!.at)));
    return drizzleLedgerUnitOfWork(h.database.db);
  }
  test('105 waiting records cannot starve the 106th; EOF then revisits old waiting IDs', async () => {
    await fixture();
    const owner = h.module.api.owner('task-runtime');
    const records = await Promise.all(Array.from({ length: 106 }, (_, n) => owner.declare({ id: newResourceId(), kind: 'volume', ref: `keyset-${n}`, projectId: PROJECT, spec: { children: [] } })));
    records.sort((a, b) => a.id.localeCompare(b.id));
    const waiting = new Set(records.slice(0, 105).map((r) => r.id));
    await h.database.db.execute(sql`update resources.records set phase='failed', retain_until=clock_timestamp()-interval '1 minute'`);
    h.module.api.registerMaintenanceEndingHandler('task-runtime', async (_step, snapshot) => waiting.has(snapshot.id) ? { status: 'waiting', reason: 'actual-owner-pending' } : { status: 'unselected' });
    await h.module.maintainOnce();
    const [cursor] = await h.database.db.execute(sql`select after_id from resources.maintenance_sweeps where step='retention'`);
    expect(cursor!.after_id).toBe(records[99]!.id);
    expect((await h.module.api.get(records[105]!.id))?.desired).toBe('present');
    await h.module.maintainOnce();
    expect((await h.module.api.get(records[105]!.id))?.desired).toBe('absent');
    waiting.delete(records[0]!.id);
    await h.module.maintainOnce(); // EOF advances epoch and resets only this scan.
    await h.module.maintainOnce();
    expect((await h.module.api.get(records[0]!.id))?.desired).toBe('absent');
    expect((await h.module.api.get(records[1]!.id))?.desired).toBe('present');
  }, 15000);
  test('renew cannot revive the same holder after lease expires while waiting for its row lock', async () => {
    const uow = await fixture(), lease = await uow.run((scope) => scope.sweeps.claim('retention', 'first-holder', 300));
    expect(lease).toBeDefined();
    let locked!: () => void, unlock!: () => void;
    const entry = new Promise<void>((resolve) => { locked = resolve; }), gate = new Promise<void>((resolve) => { unlock = resolve; });
    const blocker = h.database.db.transaction(async (tx) => { await tx.execute(sql`select step from resources.maintenance_sweeps where step='retention' for update`); locked(); await gate; });
    await entry;
    const renewing = uow.run((scope) => scope.sweeps.renew(lease!, 5000));
    const settled = renewing.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
    await pause(450); unlock(); await blocker;
    expect(await settled).toMatchObject({ ok: false, error: { details: { code: 'maintenance-lease-lost' } } });
    const takeover = await uow.run((scope) => scope.sweeps.claim('retention', 'new-holder', 5000));
    expect(takeover?.fencingToken).toBe(lease!.fencingToken + 1);
    await expect(uow.run((scope) => scope.sweeps.finish(lease!, 'late-id', false))).rejects.toMatchObject({ details: { code: 'maintenance-lease-lost' } });
    const [row] = await h.database.db.execute(sql`select lease_holder, after_id from resources.maintenance_sweeps where step='retention'`);
    expect(row).toMatchObject({ lease_holder: 'new-holder', after_id: null });
  });
  test('actual UPDATE and cursor refuse an expired lease, even without a takeover', async () => {
    const uow = await fixture(), record = await h.module.api.owner('task-runtime').declare({ kind: 'volume', ref: 'fenced-row', projectId: PROJECT, spec: { children: [] } });
    const lease = await uow.run((scope) => scope.sweeps.claim('retention', 'same-holder', 100));
    expect(lease).toBeDefined();
    await pause(150);
    expect(await uow.run((scope) => scope.records.updateForMaintenance({ ...record, desired: 'absent', version: record.version + 1 }, lease!))).toBe(false);
    await expect(uow.run((scope) => scope.sweeps.finish(lease!, record.id, false))).rejects.toMatchObject({ details: { code: 'maintenance-lease-lost' } });
    expect((await h.module.api.get(record.id))?.desired).toBe('present');
    const [row] = await h.database.db.execute(sql`select after_id from resources.maintenance_sweeps where step='retention'`);
    expect(row!.after_id).toBeNull();
  });
  test('claim computes its full lease after lock wait; old transaction now cannot shorten it', async () => {
    const uow = await fixture();
    const initial = await uow.run((scope) => scope.sweeps.claim('retention', 'seed', 100));
    await uow.run((scope) => scope.sweeps.release(initial!));
    let locked!: () => void, unlock!: () => void;
    const entry = new Promise<void>((resolve) => { locked = resolve; }), gate = new Promise<void>((resolve) => { unlock = resolve; });
    const blocker = h.database.db.transaction(async (tx) => { await tx.execute(sql`select step from resources.maintenance_sweeps where step='retention' for update`); locked(); await gate; });
    await entry;
    const claiming = uow.run((scope) => scope.sweeps.claim('retention', 'after-lock', 2000));
    await pause(350); unlock(); await blocker;
    const lease = await claiming; expect(lease?.holder).toBe('after-lock');
    const [row] = await h.database.db.execute(sql`select extract(epoch from (lease_until-clock_timestamp()))*1000 as remaining from resources.maintenance_sweeps where step='retention'`);
    expect(Number(row!.remaining)).toBeGreaterThan(1700);
  });

  function shortSweep(name: string, ttlMs: number): LedgerUnitOfWork {
    const db = new Proxy(h.database.db, { get(target, key, receiver) {
      if (key !== 'transaction') return Reflect.get(target, key, receiver);
      return (run: (tx: Executor) => Promise<unknown>) => target.transaction(async (tx) => {
        await tx.execute(sql`select set_config('application_name', ${name}, true)`);
        return run(tx);
      });
    } });
    const actual = drizzleLedgerUnitOfWork(db);
    return { ...actual, run: (run) => actual.run((scope) => run({ ...scope, sweeps: { ...scope.sweeps,
      claim: (step, holder, _ttl, cutoff) => scope.sweeps.claim(step, holder, ttlMs, cutoff),
      renew: (lease) => scope.sweeps.renew(lease, ttlMs),
    } })) };
  }
  async function commitWait(step: 'retention' | 'compaction', expired: boolean) {
    await fixture();
    const owner = h.module.api.owner('task-runtime'), record = await owner.declare({ id: newResourceId(), kind: 'volume', ref: 'commit-order-' + newResourceId(), projectId: PROJECT, spec: { children: [] } });
    if (step === 'retention') {
      await owner.report(record.id, { conditions: [{ type: 'Failed', status: 'true' }] });
      await h.database.db.execute(sql`update resources.records set retain_until=clock_timestamp()-interval '1 minute' where id=${record.id}`);
    } else {
      await owner.requestRelease(record.id, { code: 'owner-complete', message: 'already stopped' });
      await h.database.db.execute(sql`update resources.records set phase_since=clock_timestamp()-interval '8 days' where id=${record.id}`);
    }
    const before = await h.module.api.get(record.id);
    const [changesBefore] = await h.database.db.execute(sql`select count(*)::int as n from resources.changes where resource_id=${record.id}`);
    let entered!: () => void, release!: () => void;
    const entry = new Promise<void>((resolve) => { entered = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    const blocker = h.database.db.transaction(async (tx) => { await tx.execute(sql`select pg_advisory_xact_lock(hashtext('resources.change_seq'))`); entered(); await gate; });
    await entry;
    const name = 'commit-maintenance-' + newResourceId(), uow = shortSweep(name, expired ? 1000 : 5000);
    const run = (step === 'retention' ? expireRetention(uow, h.clock) : compactStopped(uow, h.clock)).then((count) => ({ count, error: undefined }), (error: unknown) => ({ count: undefined, error }));
    let blocked = false;
    try {
      for (let i = 0; i < 100; i += 1) {
        const [row] = await h.database.db.execute(sql`select exists(select 1 from pg_stat_activity where application_name=${name} and wait_event_type='Lock') as waiting`);
        if (row?.waiting === true) { blocked = true; break; }
        await pause(10);
      }
      if (blocked && expired) await h.database.db.execute(sql`select pg_sleep(1.25)`);
    } finally { release(); }
    await blocker; const result = await run;
    expect(blocked).toBe(true);
    const after = await h.module.api.get(record.id);
    const [changesAfter] = await h.database.db.execute(sql`select count(*)::int as n from resources.changes where resource_id=${record.id}`);
    if (expired) {
      expect(result.error).toMatchObject({ details: { code: 'maintenance-lease-lost' } });
      expect(after).toEqual(before);
      expect(changesAfter!.n).toBe(changesBefore!.n);
    } else {
      expect(result.error).toBeUndefined(); expect(result.count).toBe(1);
      expect(changesAfter!.n).toBe(Number(changesBefore!.n) + 1);
      if (step === 'retention') expect(after?.desired).toBe('absent');
      else expect(after?.compactedAt).toBeInstanceOf(Date);
    }
  }
  test.each(['retention', 'compaction'] as const)('%s rolls back the actual resource and change when deferred commit-lock waiting expires its lease', async (step) => { await commitWait(step, true); }, 10000);
  test.each(['retention', 'compaction'] as const)('%s commits once when the same deferred lock is released before lease expiry', async (step) => { await commitWait(step, false); }, 10000);
});
