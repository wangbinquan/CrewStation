import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ExecutionObservationIdentitySchema, ExecutionUsageObservationSchema, type ExecutionObservation } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { usageIngestion } from '../application/usageIngestion';
import { drizzleUsageLedger } from '../adapters/persistence/drizzleUsageLedger';
import type { UsageEvidence } from '../domain/usageProjection';
import type { UsageLedgerStore, UsageSourcePage } from '../ports/usageLedger';
import { observabilityMigrations } from '../wiring';

const usage = (item: ExecutionObservation | undefined) => ExecutionUsageObservationSchema.parse(item);
const available = await testDatabaseAvailable();
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase([observabilityMigrations]); });
afterAll(async () => { await tdb?.drop(); });
function sample(patch: Partial<UsageEvidence> = {}): UsageEvidence {
  return {
    kind: 'usage', identity: ExecutionObservationIdentitySchema.parse({ projectId: Bun.randomUUIDv7(), taskId: Bun.randomUUIDv7(), subtaskId: Bun.randomUUIDv7(), executionId: Bun.randomUUIDv7(), executionGeneration: 1 }),
    sourceId: 'runner', recordId: 'meter', revision: 1, occurredAt: null, observedAt: '2026-09-28T00:00:00.000Z',
    adapterVersion: 'fixture-v1', modelRef: 'provider/model', reporting: 'cumulative', inclusion: 'self',
    coverage: 'complete', validity: 'valid', scope: null, coveredThroughTurn: null,
    usage: { input: '100', output: '10', cacheRead: '0', cacheWrite: '0' }, basis: { kind: 'invocation' }, ...patch,
  };
}
function page(measurement: UsageEvidence, patch: Partial<UsageSourcePage> = {}): UsageSourcePage {
  return { projectId: measurement.identity.projectId, taskId: measurement.identity.taskId, sourceId: measurement.sourceId,
    expectedCursor: null, nextCursor: 'page:1', events: [{ eventId: 'event:1', measurement }], ...patch };
}
function setup() { const store = drizzleUsageLedger(tdb.db); return { store, ingest: usageIngestion(store) }; }

describe.skipIf(!available)('RFC-034 durable evidence and synchronization sequence', () => {
  test('replay across later pages and reopening never rolls back the source cursor', async () => {
    const { store, ingest } = setup(), first = sample(), input = page(first);
    expect(await ingest(input)).toMatchObject({ applied: 1, duplicate: 0, cursor: 'page:1' });
    const second = page({ ...first, revision: 2, usage: { ...first.usage, input: '130' } }, { expectedCursor: 'page:1', nextCursor: 'page:2', events: [{ eventId: 'event:2', measurement: { ...first, revision: 2, usage: { ...first.usage, input: '130' } } }] });
    await ingest(second);
    const reopened = drizzleUsageLedger(tdb.db);
    expect(await usageIngestion(reopened)(input)).toMatchObject({ applied: 0, duplicate: 1, cursor: 'page:2' });
    const changes = await store.changes(input, 0, 1);
    expect(changes).toMatchObject({ nextCursor: 1, persistedThrough: 2, hasMore: true });
    expect(usage(changes.items[0]).projection.contribution.input).toBe('100');
    const tail = await reopened.changes(input, changes.nextCursor, 1);
    expect(tail).toMatchObject({ nextCursor: 2, persistedThrough: 2, hasMore: false });
    expect(usage(tail.items[0]).projection.contribution.input).toBe('130');
    expect(await reopened.changes(input, 2, 20)).toMatchObject({ items: [], nextCursor: 2, hasMore: false });
  });
  test('late earlier evidence emits a new projection without advancing the native maximum', async () => {
    const { store, ingest } = setup(), first = sample(), final = { ...first, revision: 2, validity: 'invalid-final' as const, usage: { input: '0', output: '0', cacheRead: '0', cacheWrite: '0' } };
    await ingest(page(final));
    await ingest(page(first, { expectedCursor: 'page:1', nextCursor: 'page:2', events: [{ eventId: 'older', measurement: first }] }));
    const result = await store.changes(page(first), 0, 10);
    expect(result.items.map((row) => usage(row).projection.projectionRevision)).toEqual([1, 2]);
    expect(usage(result.items[1]).projection).toMatchObject({ observedRevision: 2, contribution: { input: '100' }, complete: false, issues: ['invalid-final'] });
    expect(ExecutionUsageObservationSchema.safeParse(result.items[1]).success).toBe(true);
  });
  test('conflicting event, native revision or replayed page rolls back the whole batch', async () => {
    const { store, ingest } = setup(), first = sample(), original = page(first);
    await ingest(original);
    for (const eventId of ['event:1', 'different-event']) {
      const bad = { ...first, usage: { ...first.usage, input: '999' } };
      await expect(ingest(page(first, { expectedCursor: 'page:1', nextCursor: 'page:2', events: [
        { eventId: 'another-meter', measurement: { ...first, recordId: 'another' } }, { eventId, measurement: bad },
      ] }))).rejects.toMatchObject({ kind: 'conflict' });
      expect(await store.cursor(original, first.sourceId)).toBe('page:1');
      expect((await store.changes(original, 0, 20)).persistedThrough).toBe(1);
    }
    await expect(ingest({ ...original, events: [] })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(ingest(page(first, { nextCursor: 'wrong-start' }))).rejects.toMatchObject({ kind: 'conflict' });
  });
  test('a failure after checkpoint writing rolls back evidence, projection, log and receipt', async () => {
    const { store } = setup(), first = sample(), input = page(first);
    const broken: UsageLedgerStore = { ...store, change: (scope, sourceId, work) => store.change(scope, sourceId, (tx) => work({ ...tx,
      advance: async (cursor, fingerprint) => { await tx.advance(cursor, fingerprint); throw new Error('checkpoint fault'); },
    })) };
    await expect(usageIngestion(broken)(input)).rejects.toThrow('checkpoint fault');
    expect(await store.cursor(input, first.sourceId)).toBeNull();
    expect(await store.changes(input, 0, 20)).toMatchObject({ items: [], persistedThrough: 0 });
    expect(await usageIngestion(store)(input)).toMatchObject({ applied: 1, duplicate: 0 });
  });
  test('different sources commit in task sequence order, with no uncommitted high-watermark gap', async () => {
    const { store, ingest } = setup(), first = sample(), input = page(first);
    let entered!: () => void, release!: () => void;
    const inTransaction = new Promise<void>((resolve) => { entered = resolve; });
    const proceed = new Promise<void>((resolve) => { release = resolve; });
    const delayed: UsageLedgerStore = { ...store, change: (scope, sourceId, work) => store.change(scope, sourceId, async (tx) => {
      entered(); await proceed; return work(tx);
    }) };
    const slow = usageIngestion(delayed)(input);
    await inTransaction;
    const fast = ingest(page({ ...first, sourceId: 'another-source' }));
    try { expect((await store.changes(input, 0, 20)).items).toEqual([]); }
    finally { release(); }
    await Promise.all([slow, fast]);
    const changes = await store.changes(input, 0, 20);
    expect(changes.items.map((row) => row.sourceId)).toEqual(['runner', 'another-source']);
    expect(changes.persistedThrough).toBe(2);
  });
  test('duplicate revisions under another source event do not emit another projection', async () => {
    const { store, ingest } = setup(), first = sample(), input = page(first);
    await ingest(input);
    expect(await ingest(page(first, { expectedCursor: 'page:1', nextCursor: 'page:2', events: [{ eventId: 'alias', measurement: first }] }))).toMatchObject({ applied: 0, duplicate: 1 });
    expect((await store.changes(input, 0, 20)).persistedThrough).toBe(1);
    await expect(store.changes(input, 2, 20)).rejects.toThrow('ahead');
    for (const [after, limit] of [[-1, 1], [0.5, 1], [0, 0], [0, 501], [0, 1.5]]) await expect(store.changes(input, after!, limit!)).rejects.toThrow('Invalid');
  });
  test('invalid native counts and cross-field scopes cannot advance the ledger', async () => {
    const { store, ingest } = setup(), first = sample();
    for (const measurement of [
      { ...first, usage: { ...first.usage, input: '-1' } },
      { ...first, inclusion: 'includes-descendants' as const },
    ]) await expect(ingest(page(measurement))).rejects.toThrow();
    expect((await store.changes(page(first), 0, 20)).persistedThrough).toBe(0);
  });
  test('frozen snapshot pages survive reopening and exclude later corrections or new meters', async () => {
    const { store, ingest } = setup(), first = sample(), second = { ...first, recordId: 'second', usage: { ...first.usage, input: '200' } };
    const input = page(first, { events: [{ eventId: 'one', measurement: first }, { eventId: 'two', measurement: second }] });
    await ingest(input);
    const initial = await store.snapshot(input, { limit: 1 }, 1000, 0);
    expect(initial).toMatchObject({ snapshotThrough: 2, createdAt: 1000, expiresAt: 1801000 });
    expect(initial.items).toHaveLength(1);
    expect(initial.nextCursor).not.toBeNull();
    const unseen = initial.items[0]!.recordId === first.recordId ? second : first;
    const correction = { ...unseen, revision: 2, usage: { ...unseen.usage, input: '999' } };
    const newcomer = { ...first, recordId: 'third' };
    await ingest(page(first, { expectedCursor: 'page:1', nextCursor: 'page:2', events: [{ eventId: 'correction', measurement: correction }, { eventId: 'new', measurement: newcomer }] }));
    const reopened = drizzleUsageLedger(tdb.db);
    const tail = await reopened.snapshot(input, { snapshotId: initial.snapshotId, cursor: initial.nextCursor!, limit: 1 }, 2000, 0);
    expect(tail).toMatchObject({ snapshotId: initial.snapshotId, snapshotThrough: 2, nextCursor: null, createdAt: 1000 });
    expect(tail.items[0]?.recordId).toBe(unseen.recordId);
    expect(usage(tail.items[0]).projection.contribution.input).toBe(unseen.usage.input);
    expect((await reopened.changes(input, initial.snapshotThrough, 20)).items.map((item) => item.recordId)).toEqual([unseen.recordId, 'third']);
    const refreshed = await reopened.snapshot(input, { limit: 20 }, 2000, 0);
    expect(refreshed.items).toHaveLength(3);
    expect(usage(refreshed.items.find((item) => item.recordId === unseen.recordId)).projection.contribution.input).toBe('999');
  });
  test('empty snapshots have a stable zero boundary and expired continuations require restart', async () => {
    const { store, ingest } = setup(), first = sample(), input = page(first);
    const empty = await store.snapshot(input, { limit: 1 }, 1000, 0);
    expect(empty).toMatchObject({ items: [], nextCursor: null, snapshotThrough: 0 });
    await ingest(page(first, { events: [{ eventId: 'one', measurement: first }, { eventId: 'two', measurement: { ...first, recordId: 'second' } }] }));
    const initial = await store.snapshot(input, { limit: 1 }, 1000, 0);
    await expect(store.snapshot(input, { snapshotId: initial.snapshotId, cursor: initial.nextCursor!, limit: 1 }, initial.expiresAt, 0)).rejects.toMatchObject({ kind: 'gone' });
    await expect(store.snapshot(input, { snapshotId: Bun.randomUUIDv7(), cursor: initial.nextCursor!, limit: 1 }, 2000, 0)).rejects.toMatchObject({ kind: 'not_found' });
    for (const query of [{ limit: 0 }, { limit: 501 }, { limit: 1, snapshotId: initial.snapshotId }, { limit: 1, cursor: initial.nextCursor! }, { limit: 1, snapshotId: initial.snapshotId, cursor: 'invalid' }, { limit: 1, snapshotId: '', cursor: initial.nextCursor! }])
      await expect(store.snapshot(input, query, 2000, 0)).rejects.toThrow('Invalid usage snapshot page');
  });

});
