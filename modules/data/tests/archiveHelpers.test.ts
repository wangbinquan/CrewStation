import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AcceptedArchiveFinalization, TaskId } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { dataMigrations } from '../wiring';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectId } from './objectFixtures';
import { archiveBindingRepository } from '../adapters/persistence/archive/bindings';
import { archiveHelperRepository } from '../adapters/persistence/archive/helperGrants';
import { archiveHelperGrants } from '../adapters/persistence/archive/helperTables';
import { objectUploadRepository } from '../adapters/persistence/objectUploads';
import { archiveHelpers } from '../application/archiveHelpers';
import { archiveFinalization } from '../application/archiveFinalization';
import { verifyNextObject } from '../application/objectMaintenance';
import { archiveHelperRoutes } from '../http/archiveHelperRoutes';
import type { ObjectBackendPlane } from '../ports/objectStorage';

const available = await testDatabaseAvailable(), hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const evidence = { stopProofDigest: 'a'.repeat(64), completionProofDigest: 'b'.repeat(64) };
describe.skipIf(!available)('archive helper HTTP and durable file confirmation', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([dataMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  async function fixture(bindPod = true) {
    const f = await objectArchiveFixture(tdb.db), helpers = archiveHelperRepository(tdb.db), bindings = archiveBindingRepository(tdb.db), uploads = objectUploadRepository(tdb.db);
    await f.plans.append(f.plan.id, { requestKey: 'page', expectedRevision: 1, page: 0, entries: [
      { kind: 'file', path: 'report.txt', name: '报告', required: true }, { kind: 'file', path: 'optional.txt', name: '附件', required: false },
    ] }, f.authority);
    const plan = await f.plans.seal(f.plan.id, 'seal', 2, f.authority), intent: AcceptedArchiveFinalization = {
      id: objectId(), projectId: f.source.projectId, serviceId: f.source.serviceId, taskId: f.taskId as TaskId, taskGeneration: 1,
      spaceId: f.space.id, volumeUid: objectId(), outcome: 'succeeded', archive: { planId: plan.id, planRevision: plan.revision, digest: plan.digest! },
    };
    const finalization = archiveFinalization(bindings, { accepted: async () => intent }, { plans: f.plans, reads: f.reads, helpers });
    await finalization.bind(intent.id);
    const bytes = new Map<string, string>();
    const plane: ObjectBackendPlane = {
      put: async (location, input) => { const body = await new Response(input.body).text(); if (Buffer.byteLength(body) !== input.size || hash(body) !== input.sha256) throw new Error('digest mismatch'); bytes.set(location.key, body); return { size: Buffer.byteLength(body), sha256: hash(body) }; },
      verify: async (location) => { const body = bytes.get(location.key)!; return { size: Buffer.byteLength(body), sha256: hash(body) }; },
      configure: async () => {}, metrics: () => '',
      probe: async () => { throw new Error('unexpected probe'); }, get: async () => { throw new Error('unexpected download'); }, remove: async () => { throw new Error('unexpected removal'); },
    };
    const deps = { ...f, uploads, helpers, bindings, plane, owner: objectId(), secretKeyBase64: Buffer.alloc(32, 1).toString('base64') };
    const api = archiveHelpers(deps), issue = { id: objectId(), bindingId: intent.id, revision: 1, consumerId: objectId(), expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() };
    const caller = { id: issue.id, podUid: crypto.randomUUID(), ...(await api.issue(issue)) };
    if (bindPod) await api.bind(issue.id, caller.podUid);
    const app = createApp({ name: 'archive-test' }); app.route('/', archiveHelperRoutes(api));
    const request = (path: string, method = 'GET', body?: string, token = caller.token, raw = false, podUid: string = caller.podUid) => app.request(`/internal/archive-helpers/${caller.id}${path}`, {
      method, headers: { authorization: `Bearer ${token}`, 'x-cs-archive-pod-uid': podUid, ...(body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)), 'content-type': raw ? 'application/octet-stream' : 'application/json' }) }, ...(body === undefined ? {} : { body }),
    });
    return { ...deps, api, caller, issue, request, finalization, intent };
  }
  async function uploaded(f: Awaited<ReturnType<typeof fixture>>, body = '最终产物') {
    const result = await f.request('/uploads', 'POST', JSON.stringify({ path: 'report.txt', size: Buffer.byteLength(body), sha256: hash(body) }));
    expect(result.status).toBe(201); const id = (await result.json() as { id: string }).id;
    expect((await f.request(`/uploads/${id}/content`, 'PUT', body, f.caller.token, true)).status).toBe(202);
    expect((await f.request(`/uploads/${id}/commit`, 'POST')).status).toBe(202);
    return id;
  }
  test('the issued grant stays unusable until the actual Pod UID is bound and can never be moved to a replacement', async () => {
    const f = await fixture(false);
    expect((await f.request('/entries')).status).toBe(403);
    await f.api.bind(f.issue.id, f.caller.podUid); await f.api.bind(f.issue.id, f.caller.podUid);
    expect((await f.request('/entries')).status).toBe(200);
    const replacement = crypto.randomUUID();
    expect((await f.request('/entries', 'GET', undefined, f.caller.token, false, replacement)).status).toBe(403);
    await expect(f.api.bind(f.issue.id, replacement)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.api.complete({ ...f.caller, podUid: replacement })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.api.fail({ ...f.caller, podUid: replacement }, { path: null, code: 'archive_transfer_failed' })).rejects.toMatchObject({ kind: 'forbidden' });
    for (const invalid of ['', 'pod-name', 'not-a-uuid']) {
      expect((await f.request('/entries', 'GET', undefined, f.caller.token, false, invalid)).status).toBe(403);
      await expect(f.api.bind(f.issue.id, invalid)).rejects.toThrow();
    }
    await f.api.close(f.issue.id);
    await expect(f.api.bind(f.issue.id, f.caller.podUid)).rejects.toMatchObject({ kind: 'precondition' });
  });
  test('a restart reuses credentials/upload; physical readback and explicit stable-file confirmation precede receipt', async () => {
    const f = await fixture();
    expect(await archiveHelpers(f).issue(f.issue)).toEqual({ token: f.caller.token });
    await f.catalog.applyWriteControl({ serviceId: f.source.serviceId, controlVersion: 1, epoch: 2, leaseId: objectId(), instanceId: objectId(), podUid: objectId(), leaseUntil: '2000-01-01T00:00:00Z', phase: 'frozen' });
    const id = await uploaded(f);
    expect((await f.request('/results', 'POST', JSON.stringify({ path: 'report.txt', objectId: id }))).status).toBeGreaterThanOrEqual(400);
    await expect(f.finalization.commitArchive(f.intent.id, 1, evidence)).rejects.toMatchObject({ details: { code: 'archive_helper_pending' } });
    expect(await verifyNextObject(f, new AbortController().signal)).toBe(true);
    expect((await f.reads.object(id))?.referenceCount).toBe(1);
    await expect(f.finalization.commitArchive(f.intent.id, 1, evidence)).rejects.toMatchObject({ details: { code: 'archive_helper_pending' } });
    expect((await f.request('/results', 'POST', JSON.stringify({ path: 'report.txt', objectId: id }))).status).toBe(204);
    expect((await f.request('/results', 'POST', JSON.stringify({ path: 'optional.txt', omitted: 'not-found' }))).status).toBe(204);
    await expect(f.finalization.commitArchive(f.intent.id, 1, evidence)).rejects.toMatchObject({ details: { code: 'archive_helper_pending' } });
    expect((await f.request('/complete', 'POST')).status).toBe(204);
    const receipt = await f.finalization.commitArchive(f.intent.id, 1, evidence);
    expect(receipt.receipt).toMatchObject({ disposition: 'archived', itemCount: 2, volumeUid: f.intent.volumeUid });
    expect((await f.reads.object(id))?.referenceCount).toBe(2);
    expect((await f.request('/complete', 'POST')).status).toBe(204);
    expect((await f.reads.receiptPage(f.intent.id, 0, 100))?.items).toMatchObject([{ state: 'saved', name: '报告', objectId: id }, { state: 'omitted', name: '附件' }]);
    expect((await f.request('/uploads', 'POST', JSON.stringify({ path: 'report.txt', size: 1, sha256: hash('x') }))).status).toBe(409);
    expect((await f.catalog.space(f.space.id))?.activeTransfers).toBe(0);
  });
  test('grants cannot read other uploads, bypass service fences, invent files or omit required files', async () => {
    const f = await fixture(), body = JSON.stringify({ path: 'report.txt', size: 1, sha256: hash('x') });
    expect((await f.request('/entries?limit=1')).status).toBe(200);
    expect(await (await f.request('/entries?limit=1')).json()).toMatchObject({ items: [{ path: 'report.txt' }], nextOffset: 1 });
    expect((await f.request('/entries?limit=101')).status).toBe(400);
    expect((await f.request('/entries', 'GET', undefined, 'invalid')).status).toBe(403);
    expect((await f.request('/uploads', 'POST', JSON.stringify({ path: '../secret', size: 1, sha256: hash('x') }))).status).toBe(400);
    expect((await f.request('/uploads', 'POST', JSON.stringify({ path: 'undeclared', size: 1, sha256: hash('x') }))).status).toBe(404);
    expect((await f.request('/uploads', 'POST', body.replace('"size":1', '"size":1,"fence":{}'))).status).toBe(400);
    expect((await f.request('/results', 'POST', JSON.stringify({ path: 'report.txt', omitted: 'not-found' }))).status).toBe(412);
    expect((await f.request('/complete', 'POST')).status).toBe(412);
    expect((await f.request(`/uploads/${f.object.id}`)).status).toBe(404);
    const id = (await (await f.request('/uploads', 'POST', body)).json() as { id: string }).id;
    await expect(f.uploads.begin(id, objectId(), objectId(), f.authority)).rejects.toMatchObject({ kind: 'not_found' });
    expect((await f.uploads.get(id))?.state).toBe('waiting');
    expect((await f.request('/uploads', 'POST', ' '.repeat(33_000))).status).toBe(413);
  });
  test('one immutable reservation per manifest path across replicas; changed content and fake result cannot replace it', async () => {
    const f = await fixture(), input = { path: 'report.txt', size: 1, sha256: hash('x') };
    const receipts = await Promise.all([f.api.upload(f.caller, input), archiveHelpers(f).upload(f.caller, input)]);
    expect(receipts[0]?.id).toBe(receipts[1]?.id); expect((await f.catalog.space(f.space.id))?.reservedBytes).toBe(1);
    await expect(f.api.upload(f.caller, { ...input, sha256: hash('y') })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.api.result(f.caller, { path: 'report.txt', objectId: f.object.id })).rejects.toMatchObject({ details: { code: 'archive_file_unverified' } });
    expect(JSON.stringify(receipts)).not.toContain('bindingId'); expect(JSON.stringify(receipts)).not.toContain(f.caller.token);
    const stored = (await tdb.db.select().from(archiveHelperGrants).where(eq(archiveHelperGrants.id, f.caller.id)))[0]!;
    expect(stored.body.tokenHash).toBe(hash(f.caller.token)); expect(JSON.stringify(stored)).not.toContain(f.caller.token);
  });
  test('expiry is not a stop proof: replacement stays blocked until runtime closes the original grant', async () => {
    const f = await fixture(), stored = (await tdb.db.select().from(archiveHelperGrants).where(eq(archiveHelperGrants.id, f.caller.id)))[0]!.body;
    await tdb.db.update(archiveHelperGrants).set({ body: { ...stored, expiresAt: '2000-01-01T00:00:00Z' } }).where(eq(archiveHelperGrants.id, f.caller.id));
    expect((await f.request('/entries')).status).toBe(403);
    const replacement = { ...f.issue, id: objectId(), consumerId: objectId() };
    await expect(f.api.issue(replacement)).rejects.toMatchObject({ kind: 'conflict' });
    await f.api.close(f.caller.id); await f.api.close(f.caller.id);
    expect((await f.api.issue(replacement)).token).not.toBe(f.caller.token);
    expect((await f.request('/entries')).status).toBe(403);
  });
  test('closing an unissued helper persists a tombstone and prevents a late credential from starting it', async () => {
    const f = await fixture(), late = { ...f.issue, id: objectId(), consumerId: objectId() };
    await f.api.close(late.id);
    await expect(f.api.issue(late)).rejects.toMatchObject({ kind: 'conflict' });
    expect(await f.helpers.completed(f.intent.id, 1)).toBe(false);
  });
  test('bounded failure records are scoped to the manifest and stop receipt creation without releasing the volume', async () => {
    const f = await fixture(), failure = { path: 'report.txt', code: 'archive_file_missing' };
    expect((await f.request('/failure', 'POST', JSON.stringify({ ...failure, path: 'foreign' }))).status).toBe(400);
    expect((await f.request('/failure', 'POST', JSON.stringify({ ...failure, message: 'raw secret' }))).status).toBe(400);
    expect((await f.request('/failure', 'POST', JSON.stringify(failure), 'bad-token')).status).toBe(403);
    expect((await f.request('/failure', 'POST', JSON.stringify(failure))).status).toBe(204);
    expect((await f.request('/failure', 'POST', JSON.stringify(failure))).status).toBe(204);
    expect((await f.request('/failure', 'POST', JSON.stringify({ ...failure, code: 'archive_transfer_failed' }))).status).toBe(409);
    expect(await f.helpers.failure(f.intent.id, 1)).toMatchObject({ ...failure, retryAt: null });
    expect((await f.request('/complete', 'POST')).status).toBe(403);
    expect((await f.request('/entries')).status).toBe(403);
    await expect(f.finalization.commitArchive(f.intent.id, 1, evidence)).rejects.toMatchObject({ details: { code: 'archive_file_missing' } });
    expect((await f.bindings.get(f.intent.id))!.receipt).toBeNull();
    await expect(f.api.issue({ ...f.issue, id: objectId() })).rejects.toMatchObject({ kind: 'conflict' });
    await f.api.close(f.caller.id);
    await f.api.issue({ ...f.issue, id: objectId(), consumerId: objectId() });
    expect(await f.helpers.failure(f.intent.id, 1)).toBeUndefined();
  });
  test('transient transfer failures expose a persisted retry time instead of launching repeatedly', async () => {
    const f = await fixture(); await f.api.fail(f.caller, { path: null, code: 'archive_transfer_failed' });
    const failed = await f.helpers.failure(f.intent.id, 1);
    expect(Date.parse(failed!.retryAt!) - Date.parse(failed!.at)).toBe(60_000);
    await expect(f.finalization.commitArchive(f.intent.id, 1, evidence)).rejects.toMatchObject({ details: { code: 'archive_transfer_failed' } });
    const row = (await tdb.db.select().from(archiveHelperGrants).where(eq(archiveHelperGrants.id, f.caller.id)))[0]!.body;
    await tdb.db.update(archiveHelperGrants).set({ body: { ...row, failure: { ...row.failure!, retryAt: '2000-01-01T00:00:00Z' } } }).where(eq(archiveHelperGrants.id, f.caller.id));
    await expect(f.finalization.commitArchive(f.intent.id, 1, evidence)).rejects.toMatchObject({ details: { code: 'archive_helper_pending' } });
  });
  test('backup freeze holds uploaded files; accepted archive resumes after unfreeze despite old service lease', async () => {
    const f = await fixture(), id = await uploaded(f), freeze = { id: objectId(), kind: 'backup' as const, backendId: f.backend.id, epoch: 1, active: true };
    await f.catalog.freeze(freeze);
    expect(await verifyNextObject(f, new AbortController().signal)).toBe(false);
    expect((await f.request('/results', 'POST', JSON.stringify({ path: 'optional.txt', omitted: 'not-found' }))).status).toBe(412);
    expect((await f.request('/uploads', 'POST', JSON.stringify({ path: 'optional.txt', size: 1, sha256: hash('x') }))).status).toBe(412);
    await f.catalog.freeze({ ...freeze, active: false });
    expect(await verifyNextObject(f, new AbortController().signal)).toBe(true);
    expect((await f.uploads.get(id))?.state).toBe('ready');
  });
  test('revision change fences late file commit and readback; uploaded bytes do not turn into a receipt', async () => {
    const f = await fixture(), id = await uploaded(f);
    await f.bindings.revise(f.intent.id, { expectedRevision: 1, requestKey: objectId(), archive: { noArtifactsReason: '不保留文件' }, reason: '应用确认修订', confirmDiscard: true }, f.authority);
    expect((await f.request(`/uploads/${id}/commit`, 'POST')).status).toBe(409);
    expect(await verifyNextObject(f, new AbortController().signal)).toBe(true);
    expect((await f.uploads.get(id))?.objectId).toBeNull();
    expect((await f.finalization.get(f.intent.id))?.receipt).toBeNull();
  });
});
