import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { ArchiveLossAssessment, ArchiveReceiptDto, UserId } from '@crewstation/contracts';
import { forbidden, newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionCommandFixture } from './executionCommandFixture';
import { executionOperations } from '../adapters/persistence/executionTables';
import { finalizationOperations } from '../adapters/persistence/finalization/repository';
import type { FinalizationPreparation } from '../ports/storage/preparation';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('operator finalization authority and read-only preview', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  test('project owners can finalize explicit artifacts without a live service lease; preview never wakes or cancels execution', async () => {
    const f = await executionCommandFixture(tdb.db), owner = newResourceId() as UserId, parent = (await tdb.db.select().from(executionOperations).where(eq(executionOperations.serviceId, f.serviceId)))[0]!;
    await tdb.db.update(executionOperations).set({ intent: { ...parent.intent, task: { ...parent.intent.task, completionPolicy: 'archive-and-delete' } } }).where(eq(executionOperations.id, parent.id));
    await f.request(f.path, f.input);
    const volumeUid = newResourceId(); f.env.businessWorkspace = { volumeUid, phase: 'ready' };
    const ports: FinalizationPreparation = {
      operatorArchive: { preflight: async (_actor, scope) => { expect(scope).toEqual({ taskId: f.task.id, projectId: f.projectId, serviceId: f.serviceId }); return { spaceId: newResourceId() }; }, createPlan: async () => { throw new Error('unused'); } },
      archive: { bind: async () => { throw new Error('unused'); }, commitArchive: async () => { throw new Error('unused'); }, observe: async () => true },
      runtime: { freezeBusinessStorage: async () => { throw new Error('preview must not freeze'); }, stopBusinessStorage: async () => { throw new Error('preview must not stop'); } },
    };
    const http = f.make({ finalizationPreparation: ports, authorizer: { authorize: async (actor, project) => { if (actor.userId !== owner || project !== f.projectId) throw forbidden(); return 'owner'; } } });
    http.app.route('/', http.module.http.user);
    const root = `/v3/object-storage/tasks/${f.task.id}`, headers = { 'x-cs-user-id': owner }, store = finalizationOperations(tdb.db), before = f.commands.length;
    expect((await http.request(`${root}/finalization-preview`)).status).toBe(403);
    expect((await http.request(`${root}/finalization-preview`, undefined, 'trusted', { 'x-cs-user-id': newResourceId() })).status).toBe(403);
    expect(await (await http.request(root, undefined, 'trusted', headers)).json()).toMatchObject({ canOperateStorage: true });
    expect(await (await http.request(`${root}/finalization-preview`, undefined, 'trusted', headers)).json()).toMatchObject({ task: { generation: 1, volumeUid }, activeExecutions: 1, finalization: null });
    expect(f.commands).toHaveLength(before); expect(await store.forTask(f.serviceId, f.task.id)).toBeUndefined();
    const input = { requestKey: 'operator-finish', expectedGeneration: 1, outcome: 'cancelled', reason: '应用无法接管，负责人明确终结', confirmation: 'finalize', archive: { noArtifactsReason: '此次检查明确无需保留文件' } };
    expect((await http.request(`${root}/finalize`, { ...input, archive: {} }, 'trusted', headers)).status).toBe(400);
    const accepted = await http.request(`${root}/finalize`, input, 'trusted', headers); expect(accepted.status).toBe(202);
    expect((await http.request(`${root}/delete-artifacts`, { requestKey: newResourceId(), expectedReceiptId: newResourceId(), reason: '尚未完成不能删除', confirmation: 'delete' }, 'trusted', headers)).status).toBe(412);
    const view = await accepted.json(); expect(view).toMatchObject({ phase: 'requested', outcome: 'cancelled', computeStopped: false });
    expect((await store.forTask(f.serviceId, f.task.id))!.acceptedBy).toEqual({ type: 'user', userId: owner, reason: input.reason });
    expect(await (await http.request(`${root}/finalize`, input, 'trusted', headers)).json()).toEqual(view);
    expect(f.commands).toHaveLength(before);
  });
  test('loss confirmation requires a current owner and the reviewed snapshot; a lost reply is replayable without inventing execution evidence', async () => {
    const f = await executionCommandFixture(tdb.db), owner = newResourceId() as UserId;
    const parent = (await tdb.db.select().from(executionOperations).where(eq(executionOperations.serviceId, f.serviceId)))[0]!;
    await tdb.db.update(executionOperations).set({ intent: { ...parent.intent, task: { ...parent.intent.task, completionPolicy: 'archive-and-delete' } } }).where(eq(executionOperations.id, parent.id));
    const store = finalizationOperations(tdb.db), volumeUid = newResourceId();
    const op = await store.accept(f.serviceId, f.task.id, { requestKey: 'finish', expectedGeneration: 1, outcome: 'failed', archive: { noArtifactsReason: '执行结果损坏' }, fence: f.fence },
      { spaceId: newResourceId(), volumeUid, authorization: { fence: f.fence, source: { ...f.sources.get('trusted')!.source, role: 'prod' } } });
    const assessment: ArchiveLossAssessment = { operationId: op.id, revision: 1, volumeUid, assessmentDigest: 'a'.repeat(64), items: [], itemCount: 0, savedCount: 0, lostCount: 0, nextOffset: null };
    let receipt: ArchiveReceiptDto | null = null, replyLost = true, ownerAllowed = true, reads = 0;
    const digests: Array<string | null> = [];
    const ports: FinalizationPreparation = {
      archive: { lossReceipt: async () => receipt, bind: async () => { throw new Error('unused'); }, commitArchive: async () => { throw new Error('unused'); }, observe: async () => true },
      runtime: { freezeBusinessStorage: async () => { throw new Error('unused'); }, stopBusinessStorage: async () => { throw new Error('unused'); } },
      operatorArchive: { preflight: async () => { throw new Error('unused'); }, createPlan: async () => { throw new Error('unused'); },
        assessLoss: async (_actor, scope, id, revision, page) => {
          reads++; expect(scope).toEqual({ projectId: f.projectId, serviceId: f.serviceId, taskId: f.task.id }); expect(id).toBe(op.id); expect(revision).toBe(1); expect(page.limit).toBeLessThanOrEqual(100); return assessment;
        },
        confirmLoss: async (actor, _scope, id, input, digest) => {
          digests.push(digest); receipt ??= { id, taskId: f.task.id, finalizationId: op.id, finalizationRevision: 1, taskGeneration: 2, volumeUid, manifestDigest: 'a'.repeat(64), disposition: 'loss', itemCount: 0,
            noArtifactsReason: null, lossActorId: actor.userId, lossReason: input.reason, createdAt: new Date().toISOString() };
          if (replyLost) { replyLost = false; throw new Error('lost response after receipt commit'); } return receipt;
        },
      },
    };
    const http = f.make({ finalizationPreparation: ports, authorizer: { authorize: async (actor, project, action) => { expect(action).toBe('manage-task-storage'); if (!ownerAllowed || actor.userId !== owner || project !== f.projectId) throw forbidden(); return 'owner'; } } });
    http.app.route('/', http.module.http.user);
    const root = `/v3/object-storage/tasks/${f.task.id}`, headers = { 'x-cs-user-id': owner };
    expect((await http.request(`${root}/loss-assessment`)).status).toBe(403); expect(reads).toBe(0);
    const preview = await (await http.request(`${root}/loss-assessment?limit=1`, undefined, 'trusted', headers)).json();
    expect(preview).toMatchObject({ volumeUid, resultsIncomplete: true, executionStopConfirmed: false }); expect(preview.dataDigest).toBeUndefined();
    expect(preview.assessmentDigest).not.toBe(assessment.assessmentDigest); expect(await store.get(op.id)).toEqual(op);
    const input = { requestKey: 'loss-1', expectedRevision: 1, assessmentDigest: preview.assessmentDigest, reason: '负责人确认报告已损坏', confirmation: 'accept-loss' };
    expect((await http.request(`${root}/confirm-loss`, { ...input, confirmation: 'yes' }, 'trusted', headers)).status).toBe(400);
    expect((await http.request(`${root}/confirm-loss`, { ...input, assessmentDigest: 'b'.repeat(64) }, 'trusted', headers)).status).toBe(409); expect(digests).toEqual([]);
    expect((await http.request(`${root}/confirm-loss`, input, 'trusted', headers)).status).toBe(500);
    expect(await (await http.request(`${root}/confirm-loss`, input, 'trusted', headers)).json()).toMatchObject({ disposition: 'loss', lossActorId: owner, lossReason: input.reason });
    expect(digests).toEqual([assessment.assessmentDigest, null]); expect((await store.get(op.id))!.view.computeStopped).toBe(false);
    ownerAllowed = false; expect((await http.request(`${root}/confirm-loss`, input, 'trusted', headers)).status).toBe(403); expect(digests).toHaveLength(2);
  });
});
