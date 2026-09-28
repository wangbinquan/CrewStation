import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { AcceptedArchiveFinalization, AcceptedArchiveRevision, ServiceId, TaskId } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { dataMigrations } from '../wiring';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectId } from './objectFixtures';
import { archiveBindingRepository } from '../adapters/persistence/archive/bindings';
import { archiveFinalization } from '../application/archiveFinalization';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-035 accepted finalization authority across modules', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([dataMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  async function fixture() {
    const f = await objectArchiveFixture(tdb.db);
    await f.plans.append(f.plan.id, { requestKey: 'page', expectedRevision: 1, page: 0, entries: [{ kind: 'object', objectId: f.object.id, name: 'saved' }] }, f.authority);
    const plan = await f.plans.seal(f.plan.id, 'seal', 2, f.authority);
    const intent: AcceptedArchiveFinalization = { id: objectId(), projectId: f.source.projectId, serviceId: f.source.serviceId, taskId: f.taskId as TaskId, taskGeneration: 2,
      spaceId: f.space.id, volumeUid: objectId(), outcome: 'succeeded', archive: { planId: plan.id, planRevision: plan.revision, digest: plan.digest! } };
    const accepted = new Map<string, AcceptedArchiveFinalization>([[intent.id, intent]]), bindings = archiveBindingRepository(tdb.db);
    const changes = new Map<string, AcceptedArchiveRevision>();
    const api = archiveFinalization(bindings, { accepted: async (id) => accepted.get(id), revision: async (id) => changes.get(id) }, { plans: f.plans, reads: f.reads });
    return { ...f, intent, accepted, changes, bindings, api };
  }
  test('an irreversible intake continues after service expiry/freeze while new application writes remain fenced', async () => {
    const f = await fixture();
    await f.catalog.applyWriteControl({ serviceId: f.source.serviceId, controlVersion: 1, epoch: 3, leaseId: objectId(), instanceId: objectId(), podUid: objectId(), leaseUntil: '2000-01-01T00:00:00Z', phase: 'frozen' });
    const { projectId: _project, serviceId: _service, ...input } = f.intent;
    await expect(f.bindings.prepare(input, { source: { ...f.source, fenced: true } })).rejects.toMatchObject({ details: { code: 'storage_write_fenced' } });
    const bound = await f.api.bind(f.intent.id);
    expect(bound).toMatchObject({ state: 'bound', taskGeneration: 2, volumeUid: f.intent.volumeUid, revision: 1, receipt: null });
    expect(await archiveFinalization(f.bindings, { accepted: async (id) => f.accepted.get(id) }).bind(f.intent.id)).toEqual(bound);
    expect((await f.plans.get(f.plan.id))!.state).toBe('bound'); expect((await f.reads.object(f.object.id))!.referenceCount).toBe(1);
    expect(await f.api.get(f.intent.id)).toEqual(bound);
    expect(bound).not.toHaveProperty('items'); expect(bound).not.toHaveProperty('requestDigest');
  });
  test('unaccepted, changed and cross-service intents cannot seize another task plan', async () => {
    const f = await fixture();
    await expect(f.api.bind(objectId())).rejects.toMatchObject({ kind: 'not_found' });
    f.accepted.set(f.intent.id, { ...f.intent, id: objectId() });
    await expect(f.api.bind(f.intent.id)).rejects.toMatchObject({ kind: 'conflict' });
    f.accepted.set(f.intent.id, { ...f.intent, serviceId: objectId() as ServiceId });
    await expect(f.api.bind(f.intent.id)).rejects.toMatchObject({ kind: 'not_found' });
    expect(await f.bindings.get(f.intent.id)).toBeUndefined();
    f.accepted.set(f.intent.id, f.intent); await f.api.bind(f.intent.id);
    f.accepted.set(f.intent.id, { ...f.intent, volumeUid: objectId() });
    await expect(f.api.bind(f.intent.id)).rejects.toMatchObject({ kind: 'conflict' });
    expect((await f.bindings.get(f.intent.id))!.volumeUid).toBe(f.intent.volumeUid);
  });
  test('backup freeze blocks the persistent handshake without unpinning; original intake resumes after the same freeze is released', async () => {
    const f = await fixture(), freeze = { id: objectId(), kind: 'backup' as const, backendId: f.backend.id, epoch: 1, active: true };
    await f.catalog.freeze(freeze);
    await expect(f.api.bind(f.intent.id)).rejects.toMatchObject({ details: { code: 'object_storage_frozen' } });
    expect(await f.bindings.get(f.intent.id)).toBeUndefined(); expect((await f.plans.get(f.plan.id))!.state).toBe('sealed');
    expect((await f.reads.object(f.object.id))!.referenceCount).toBe(1);
    await f.catalog.freeze({ ...freeze, active: false });
    expect((await f.api.bind(f.intent.id)).state).toBe('bound');
  });
  test('accepted revisions survive expired service leases and data restart; a winning old receipt rejects R2', async () => {
    for (const receiptWins of [false, true]) {
      const f = await fixture(); await f.api.bind(f.intent.id);
      const change: AcceptedArchiveRevision = { id: objectId(), finalizationId: f.intent.id, projectId: f.intent.projectId, serviceId: f.intent.serviceId, taskId: f.intent.taskId, spaceId: f.space.id,
        input: { requestKey: 'amend', expectedGeneration: 2, expectedRevision: 1, archive: { noArtifactsReason: 'explicitly corrected' }, reason: 'no longer required', confirmDiscard: true }, actor: { podUid: objectId(), epoch: 1 } };
      f.changes.set(change.id, change);
      if (receiptWins) await f.api.commitArchive(f.intent.id, 1, { stopProofDigest: 'a'.repeat(64), completionProofDigest: 'b'.repeat(64) });
      await f.catalog.applyWriteControl({ serviceId: f.source.serviceId, controlVersion: 1, epoch: 3, leaseId: objectId(), instanceId: objectId(), podUid: objectId(), leaseUntil: '2000-01-01T00:00:00Z', phase: 'frozen' });
      const result = await f.api.revise(change.id); expect(result.applied).toBe(!receiptWins);
      expect(await f.api.revise(change.id)).toEqual(result);
      expect(result.binding.revision).toBe(receiptWins ? 1 : 2);
      if (!receiptWins) {
        f.accepted.set(f.intent.id, { ...f.intent, archive: change.input.archive });
        expect((await f.api.bind(f.intent.id)).revision).toBe(2);
        f.accepted.set(f.intent.id, { ...f.intent, archive: change.input.archive, serviceId: objectId() as ServiceId });
        await expect(f.api.bind(f.intent.id)).rejects.toMatchObject({ kind: 'not_found' });
        f.accepted.set(f.intent.id, { ...f.intent, archive: change.input.archive });
        await expect(f.api.commitArchive(f.intent.id, 1, { stopProofDigest: 'a'.repeat(64), completionProofDigest: 'b'.repeat(64) })).rejects.toThrow();
        expect((await f.api.commitArchive(f.intent.id, 2, { stopProofDigest: 'c'.repeat(64), completionProofDigest: 'b'.repeat(64) })).receipt).toMatchObject({ disposition: 'empty', finalizationRevision: 2 });
      }
      await expect(f.api.revise(objectId())).rejects.toMatchObject({ kind: 'not_found' });
    }
  });
  test('requested finalization can repair a plan aborted before binding; no R1 receipt or unreviewed discard can win', async () => {
    const f = await objectArchiveFixture(tdb.db), bindings = archiveBindingRepository(tdb.db);
    await f.plans.append(f.plan.id, { requestKey: 'file', expectedRevision: 1, page: 0, entries: [{ kind: 'file', name: 'required', path: 'result.txt', required: true }] }, f.authority);
    const plan = await f.plans.seal(f.plan.id, 'seal', 2, f.authority);
    const original: AcceptedArchiveFinalization = { id: objectId(), taskId: f.taskId as TaskId, serviceId: f.source.serviceId, projectId: f.source.projectId, spaceId: f.space.id,
      taskGeneration: 2, volumeUid: objectId(), outcome: 'failed', archive: { planId: plan.id, planRevision: plan.revision, digest: plan.digest! } };
    await f.plans.abort(plan.id, plan.revision, f.authority);
    const change: AcceptedArchiveRevision = { id: objectId(), finalizationId: original.id, taskId: original.taskId, projectId: original.projectId, serviceId: original.serviceId, spaceId: original.spaceId,
      input: { requestKey: 'repair', expectedGeneration: 2, expectedRevision: 1, archive: { noArtifactsReason: '明确放弃此前文件' }, reason: '清单错误', confirmDiscard: false }, actor: { podUid: objectId(), epoch: 1 } };
    let accepted = original;
    const api = archiveFinalization(bindings, { accepted: async () => accepted, revision: async () => change }, { plans: f.plans, reads: f.reads });
    await expect(api.bind(original.id)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(api.revise(change.id)).rejects.toMatchObject({ details: { code: 'archive_discard_confirmation_required', discardedPaths: ['result.txt'] } });
    expect(await bindings.get(original.id)).toBeUndefined();
    change.input.confirmDiscard = true;
    const result = await api.revise(change.id); expect(result).toMatchObject({ applied: true, binding: { revision: 2, state: 'bound' } });
    expect(await api.revise(change.id)).toEqual(result);
    accepted = { ...original, archive: change.input.archive };
    expect((await api.bind(original.id)).revision).toBe(2);
    await expect(api.commitArchive(original.id, 1, { stopProofDigest: 'a'.repeat(64), completionProofDigest: 'b'.repeat(64) })).rejects.toThrow();
    expect((await api.commitArchive(original.id, 2, { stopProofDigest: 'a'.repeat(64), completionProofDigest: 'b'.repeat(64) })).receipt?.disposition).toBe('empty');
  });
  test('selected verified objects publish one immutable receipt independent of service lease; replay cannot replace proofs', async () => {
    const f = await fixture(), evidence = { stopProofDigest: 'a'.repeat(64), completionProofDigest: 'b'.repeat(64) };
    await f.api.bind(f.intent.id);
    await f.catalog.applyWriteControl({ serviceId: f.source.serviceId, controlVersion: 1, epoch: 3, leaseId: objectId(), instanceId: objectId(), podUid: objectId(), leaseUntil: '2000-01-01T00:00:00Z', phase: 'frozen' });
    const result = await f.api.commitArchive(f.intent.id, 1, evidence);
    expect(result).toMatchObject({ state: 'receipted', receipt: { disposition: 'archived', itemCount: 1, volumeUid: f.intent.volumeUid } });
    expect((await f.reads.receiptPage(f.intent.id, 0, 100))?.items).toMatchObject([{ state: 'saved', name: 'saved', objectId: f.object.id }]);
    expect(await f.api.commitArchive(f.intent.id, 1, evidence)).toEqual(result);
    await expect(f.api.commitArchive(f.intent.id, 1, { ...evidence, stopProofDigest: 'c'.repeat(64) })).rejects.toMatchObject({ kind: 'conflict' });
    expect((await f.reads.object(f.object.id))!.referenceCount).toBe(2);
  });
  test('an explicit empty archive records its reason; files require the helper and cannot be omitted implicitly', async () => {
    const f = await objectArchiveFixture(tdb.db), bindings = archiveBindingRepository(tdb.db), evidence = { stopProofDigest: 'a'.repeat(64), completionProofDigest: 'b'.repeat(64) };
    const intent: AcceptedArchiveFinalization = { id: objectId(), projectId: f.source.projectId, serviceId: f.source.serviceId, taskId: f.taskId as TaskId, taskGeneration: 2,
      spaceId: f.space.id, volumeUid: objectId(), outcome: 'failed', archive: { noArtifactsReason: '不保留中间产物' } };
    const api = archiveFinalization(bindings, { accepted: async () => intent }, { plans: f.plans, reads: f.reads });
    await api.bind(intent.id);
    expect((await api.commitArchive(intent.id, 1, evidence)).receipt).toMatchObject({ disposition: 'empty', itemCount: 0, noArtifactsReason: '不保留中间产物' });
    const other = await objectArchiveFixture(tdb.db);
    await other.plans.append(other.plan.id, { requestKey: 'file', expectedRevision: 1, page: 0, entries: [{ kind: 'file', path: 'result.txt', name: 'result', required: false }] }, other.authority);
    const plan = await other.plans.seal(other.plan.id, 'seal', 2, other.authority);
    const pending: AcceptedArchiveFinalization = { ...intent, id: objectId(), projectId: other.source.projectId, serviceId: other.source.serviceId, taskId: other.taskId as TaskId, spaceId: other.space.id, archive: { planId: plan.id, planRevision: plan.revision, digest: plan.digest! } };
    const fileApi = archiveFinalization(bindings, { accepted: async () => pending }, { plans: other.plans, reads: other.reads });
    await fileApi.bind(pending.id);
    await expect(fileApi.commitArchive(pending.id, 1, evidence)).rejects.toMatchObject({ details: { code: 'archive_helper_pending' } });
    expect((await fileApi.get(pending.id))?.receipt).toBeNull();
  });
});
