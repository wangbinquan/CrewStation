import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { ReleaseId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { dataMigrations } from '../../data';
import { objectCatalogRepository } from '../../data/adapters/persistence/objectCatalog';
import { objectUploadRepository } from '../../data/adapters/persistence/objectUploads';
import { backendFixture, sourceFixture } from '../../data/tests/objectFixtures';
import { businessTaskMigrations } from '../wiring';
import { drizzleExecutionControls } from '../adapters/persistence/executionControl';
import { storageControlOutbox } from '../adapters/persistence/control-projection/repository';
import { storageSynchronizedControls } from '../application/storageControl';
import { assertExecutionFence, controlDto, type ExecutionAuthority, type ExecutionControl } from '../domain/executionControl';
import type { StorageControlUpdate } from '../domain/storageControl';

const available = await testDatabaseAvailable();
const lease = (c: ExecutionControl) => ({ expectedEpoch: c.epoch, leaseId: c.leaseId!, instanceId: c.leaseOwner! });
const fence = (c: ExecutionControl) => ({ epoch: c.epoch, leaseId: c.leaseId!, instanceId: c.leaseOwner! });
describe.skipIf(!available)('durable business control and object storage handshake', () => {
  let db: TestDatabase;
  beforeAll(async () => { db = await createTestDatabase([dataMigrations, businessTaskMigrations]); });
  afterAll(async () => { await db?.drop(); });
  async function fixture() {
    const source = { ...sourceFixture(), fenced: true }, catalog = objectCatalogRepository(db.db), uploads = objectUploadRepository(db.db);
    const backend = await catalog.registerBackend(backendFixture({ health: 'ready' }));
    const plan = await catalog.savePlan(newResourceId(), { name: 'Test', backendId: backend.id, quotaBytes: 1000, maxObjectBytes: 1000, maxConcurrentTransfers: 4, enabled: true });
    await catalog.authorizePlans(source.projectId, 1, [plan.id]);
    const space = await catalog.ensureSpace({ ...source, id: newResourceId(), planId: plan.id, deploymentMode: 'local' });
    const authority: ExecutionAuthority = { releaseId: newResourceId() as ReleaseId, physicalSlot: 'blue', podUid: source.podUid!, ready: true, role: 'prod' };
    const raw = drizzleExecutionControls(db.db, true), outbox = storageControlOutbox(db.db);
    const sink = { apply: catalog.applyWriteControl }, controls = storageSynchronizedControls(raw, outbox, sink);
    const reserve = (control: ExecutionControl, podUid = source.podUid) => uploads.reserve(space.id, newResourceId(), { requestKey: newResourceId(), name: 'report', size: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', mediaType: 'application/octet-stream' }, { source: { ...source, podUid }, fence: fence(control) });
    return { serviceId: source.serviceId, authority, catalog, raw, outbox, controls, reserve };
  }
  test('activation remains unready until data ACK; a response lost after apply recovers from the durable outbox', async () => {
    const f = await fixture(), claim = (await f.controls.claim(f.serviceId, f.authority, { instanceId: newResourceId() })).control!;
    let loseAck = true;
    const lossy = storageSynchronizedControls(f.raw, { ...f.outbox, acknowledge: async (input) => { if (loseAck) throw new Error('ack unavailable'); return f.outbox.acknowledge(input); } }, { apply: f.catalog.applyWriteControl });
    await expect(lossy.activate(f.serviceId, f.authority, { ...lease(claim), preparationDigest: 'a'.repeat(64) })).rejects.toThrow('ack unavailable');
    const pending = await f.raw.read(f.serviceId);
    expect(controlDto(pending.control, pending.now).phase).toBe('preparing');
    expect(() => assertExecutionFence(pending.control, { source: f.authority, fence: fence(claim) }, pending.now)).toThrow('执行权已变化');
    expect(await f.controls.quiescent(f.serviceId)).toBe(false);
    loseAck = false;
    expect(await lossy.syncPending()).toBe(1);
    const current = await f.raw.read(f.serviceId);
    expect(controlDto(current.control, current.now).phase).toBe('active');
    expect(assertExecutionFence(current.control, { source: f.authority, fence: fence(claim) }, current.now)).toBe(claim.epoch);
    expect((await f.reserve(current.control!)).state).toBe('waiting');
    expect(await f.outbox.pending(100)).toHaveLength(0);
  });
  test('freeze cannot report quiescence without data; an older delayed renew never reopens the frozen store', async () => {
    const f = await fixture(), claim = (await f.controls.claim(f.serviceId, f.authority, { instanceId: newResourceId() })).control!;
    const active = (await f.controls.activate(f.serviceId, f.authority, { ...lease(claim), preparationDigest: 'b'.repeat(64) })).control!;
    await f.raw.renew(f.serviceId, f.authority, lease(active));
    const oldRenew = (await f.outbox.pending(100)).find((u) => u.serviceId === f.serviceId)!;
    const unavailable = storageSynchronizedControls(f.raw, f.outbox, { apply: async () => { throw new Error('data unavailable'); } });
    await expect(unavailable.freeze(f.serviceId, { operationId: newResourceId(), expectedActiveReleaseId: f.authority.releaseId, targetReleaseId: newResourceId() as ReleaseId, targetSlot: 'green' })).rejects.toThrow('data unavailable');
    expect(await f.controls.quiescent(f.serviceId)).toBe(false);
    expect(await f.controls.syncPending()).toBe(1);
    expect(await f.controls.quiescent(f.serviceId)).toBe(true);
    expect(await f.catalog.applyWriteControl(oldRenew)).toBe(false);
    expect(await f.outbox.acknowledge(oldRenew)).toBeUndefined();
    await expect(f.reserve(active)).rejects.toMatchObject({ details: { code: 'storage_write_fenced' } });
  });
  test('data fences the exact Pod and lease deadline', async () => {
    const f = await fixture(), claim = (await f.controls.claim(f.serviceId, f.authority, { instanceId: newResourceId() })).control!;
    const active = (await f.controls.activate(f.serviceId, f.authority, { ...lease(claim), preparationDigest: 'c'.repeat(64) })).control!;
    await expect(f.reserve(active, 'forged-pod')).rejects.toMatchObject({ details: { code: 'storage_write_fenced' } });
    await db.db.execute(sql`UPDATE data.object_write_control SET body = jsonb_set(body, '{leaseUntil}', to_jsonb((clock_timestamp() - interval '1 second')::text)) WHERE service_id = ${f.serviceId}`);
    await expect(f.reserve(active)).rejects.toMatchObject({ details: { code: 'storage_write_fenced' } });
  });
  test('migration freezes use the same versioned outbox and persist across a controller restart', async () => {
    const f = await fixture(), claim = (await f.controls.claim(f.serviceId, f.authority, { instanceId: newResourceId() })).control!;
    const active = (await f.controls.activate(f.serviceId, f.authority, { ...lease(claim), preparationDigest: 'd'.repeat(64) })).control!;
    const request = { operationId: newResourceId(), expectedActiveReleaseId: f.authority.releaseId, targetReleaseId: newResourceId() as ReleaseId };
    const frozen = await f.raw.freezeMigration(f.serviceId, request);
    expect(frozen.control!.storageSync!.acknowledgedVersion).toBeLessThan(frozen.control!.storageSync!.version);
    const recovered = storageSynchronizedControls(drizzleExecutionControls(db.db, true), storageControlOutbox(db.db), { apply: f.catalog.applyWriteControl });
    expect(await recovered.syncPending()).toBe(1);
    const receipt = await recovered.migrationReady(f.serviceId, f.authority, { operationId: request.operationId, expectedEpoch: frozen.control!.epoch, preparationDigest: 'e'.repeat(64) });
    expect(receipt.control!.storageSync!.version).toBe(receipt.control!.storageSync!.acknowledgedVersion);
    await expect(f.reserve(active)).rejects.toMatchObject({ details: { code: 'storage_write_fenced' } });
    expect((await f.outbox.pending(100)).some((u) => u.serviceId === f.serviceId)).toBe(false);
  });
  test('a failed space delivery does not starve other services or their execution recovery', async () => {
    const a = await fixture(), b = await fixture();
    await a.raw.claim(a.serviceId, a.authority, { instanceId: newResourceId() });
    await b.raw.claim(b.serviceId, b.authority, { instanceId: newResourceId() });
    const controls = storageSynchronizedControls(a.raw, a.outbox, { apply: async (u: StorageControlUpdate) => { if (u.serviceId === a.serviceId) throw new Error('first fails'); return b.catalog.applyWriteControl(u); } });
    expect(await controls.syncPending()).toBe(1);
    expect((await a.outbox.pending(100)).map((u) => u.serviceId)).toEqual([a.serviceId]);
    await a.controls.syncPending();
  });
});
