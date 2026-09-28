import { and, eq, ne } from 'drizzle-orm';
import type { AcceptedArchiveRevision } from '@crewstation/contracts';
import { ObjectStorageBlockerSchema } from '@crewstation/contracts';
import { conflict, jsonHash, notFound, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { FinalizationBinding } from '../../../domain/objectStorage';
import { assertSameStorageRequest, assertStorageRevision } from '../../../domain/objectStorage';
import type { ArchiveBindingRepository, PrepareArchiveBinding } from '../../../ports/archiveBindings';
import { objectStorageTransaction, authorizeObjectWrite, requireObjectSpace, assertObjectStorageUnfrozen } from '../objectCatalog';
import { finalizationBindings } from '../objectTables';
import { archiveUnfrozen, requireArchiveBinding, retireArchivePlan, saveArchiveBinding, selectArchivePlan } from './bindingState';
import { archiveReceiptRepository } from './receipts';
import { requireArchivePlan } from './plans';
import { recordArchiveRevision, replayArchiveRevision } from './revisions';
import { revisionBinding } from './revisionPreparation';
import { discardedRequiredFiles } from '../../../domain/archiveRevision';
import { deleteArchiveArtifacts } from './artifacts';

export function archiveBindingRepository(db: Database): ArchiveBindingRepository {
  return {
    deleteArtifacts: deleteArchiveArtifacts(db),
    get: async (id) => (await db.select().from(finalizationBindings).where(eq(finalizationBindings.id, id)))[0]?.body,
    observe: (id, revision, sequence, observation) => objectStorageTransaction(db, async (tx, now) => {
      const binding = await requireArchiveBinding(tx, id);
      if (!Number.isSafeInteger(sequence) || sequence < 1) throw conflict('归档观测顺序无效');
      if (binding.revision !== revision || sequence <= (binding.observationSequence ?? 0) || ['aborted', 'completed'].includes(binding.state)) return false;
      if (observation) {
        ObjectStorageBlockerSchema.parse(observation);
        if (observation.operationId !== id || observation.taskId !== binding.taskId) throw conflict('归档观测不属于此终结操作');
      }
      await saveArchiveBinding(tx, { ...binding, observationSequence: sequence, observation, updatedAt: now.toISOString() });
      return true;
    }),
    prepare: (input, authority) => objectStorageTransaction(db, async (tx, now) => {
      await authorizeObjectWrite(tx, await requireObjectSpace(tx, input.spaceId), authority.source, authority.fence, now);
      return prepareBinding(tx, input, now);
    }),
    prepareAccepted: (input, scope) => objectStorageTransaction(db, async (tx, now) => {
      const space = await requireObjectSpace(tx, input.spaceId);
      if (space.projectId !== scope.projectId || space.serviceId !== scope.serviceId || space.env !== 'production') throw notFound('终结对象空间');
      await assertObjectStorageUnfrozen(tx, space.backendId);
      return prepareBinding(tx, input, now);
    }),
    confirm: (id, revision) => objectStorageTransaction(db, async (tx, now) => {
      const binding = await requireArchiveBinding(tx, id); await archiveUnfrozen(tx, binding); assertStorageRevision(binding.revision, revision);
      if (binding.state !== 'prepared') { if (binding.state === 'aborted') throw precondition('归档绑定已撤销'); return binding; }
      return saveArchiveBinding(tx, { ...binding, state: 'bound', updatedAt: now.toISOString() });
    }),
    abort: (id, revision) => objectStorageTransaction(db, async (tx, now) => {
      const binding = await requireArchiveBinding(tx, id); await archiveUnfrozen(tx, binding); assertStorageRevision(binding.revision, revision);
      if (binding.state === 'aborted') return binding;
      if (binding.state !== 'prepared') throw precondition('已受理的终结不能撤销归档保护');
      await retireArchivePlan(tx, binding, now, false);
      return saveArchiveBinding(tx, { ...binding, state: 'aborted', observation: null, updatedAt: now.toISOString() });
    }),
    revise: (id, input, authority) => objectStorageTransaction(db, async (tx, now) => {
      const binding = await requireArchiveBinding(tx, id);
      await authorizeObjectWrite(tx, await requireObjectSpace(tx, binding.spaceId), authority.source, authority.fence, now);
      return reviseBinding(tx, binding, input, authority, now);
    }),
    reviseAccepted: (change, original) => objectStorageTransaction(db, async (tx, now) => {
      const binding = await revisionBinding(tx, change, original, now), space = await requireObjectSpace(tx, binding.spaceId);
      if (space.projectId !== change.projectId || space.serviceId !== change.serviceId || binding.spaceId !== change.spaceId || binding.taskId !== change.taskId) throw notFound('终结归档修订');
      await archiveUnfrozen(tx, binding);
      const { expectedRevision, requestKey, archive, reason, confirmDiscard } = change.input;
      return reviseBinding(tx, binding, { expectedRevision, requestKey, archive, reason, confirmDiscard }, { source: { serviceId: space.serviceId, projectId: space.projectId, env: space.env, fenced: false } }, now, { id: change.id, actor: change.actor });
    }),
    ...archiveReceiptRepository(db),
  };
}

async function prepareBinding(tx: Executor, input: PrepareArchiveBinding, now: Date): Promise<FinalizationBinding> {
  const digest = jsonHash(input), previous = (await tx.select().from(finalizationBindings).where(eq(finalizationBindings.id, input.id)))[0]?.body;
  if (previous) {
    if (previous.revision > 1) {
      const manifest = 'digest' in input.archive ? input.archive.digest : jsonHash(input.archive);
      if (previous.spaceId !== input.spaceId || previous.taskId !== input.taskId || previous.volumeUid !== input.volumeUid || previous.taskGeneration !== input.taskGeneration || previous.outcome !== input.outcome || previous.manifestDigest !== manifest) throw conflict('修订后的归档绑定与持久业务意图不符');
    } else assertSameStorageRequest(previous.requestDigest, digest);
    return previous;
  }
  if ((await tx.select({ id: finalizationBindings.id }).from(finalizationBindings).where(and(eq(finalizationBindings.taskId, input.taskId), ne(finalizationBindings.state, 'aborted'))).limit(1)).length) throw conflict('任务已有终结归档绑定');
  const selected = await selectArchivePlan(tx, input.spaceId, input.taskId, input.archive);
  const binding: FinalizationBinding = { id: input.id, spaceId: input.spaceId, taskId: input.taskId, taskGeneration: input.taskGeneration, volumeUid: input.volumeUid, outcome: input.outcome, requestDigest: digest,
    ...selected, manifestDigest: selected.manifestDigest ?? jsonHash(input.archive), revision: 1, state: 'prepared', receipt: null, items: [], stopProofDigest: null, completionProofDigest: null, deletePermitId: null, reclaimProofId: null, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  await tx.insert(finalizationBindings).values({ id: input.id, taskId: input.taskId, spaceId: input.spaceId, state: binding.state, body: binding }); return binding;
}

async function reviseBinding(tx: Executor, binding: FinalizationBinding, input: Parameters<ArchiveBindingRepository['revise']>[1], authority: Parameters<ArchiveBindingRepository['revise']>[2], now: Date, acceptedChange?: Pick<AcceptedArchiveRevision, 'id' | 'actor'>) {
  if (await replayArchiveRevision(tx, binding, input)) return binding;
  assertStorageRevision(binding.revision, input.expectedRevision);
  if (binding.state !== 'bound' || binding.receipt) throw precondition('仅尚未提交收据的已受理终结可以修订清单');
  const oldPlan = binding.planId ? await requireArchivePlan(tx, binding.planId) : undefined;
  const newPlan = 'planId' in input.archive ? await requireArchivePlan(tx, input.archive.planId) : undefined;
  const discarded = discardedRequiredFiles(oldPlan?.entries ?? [], newPlan?.entries ?? []).map((entry) => entry.path);
  if (discarded.length && !input.confirmDiscard) throw precondition('修订将丢弃必需文件，必须明确确认', { code: 'archive_discard_confirmation_required', discardedPaths: discarded.slice(0, 100), discardedCount: discarded.length });
  const selected = await selectArchivePlan(tx, binding.spaceId, binding.taskId, input.archive);
  await retireArchivePlan(tx, binding, now, true);
  const next = { ...binding, ...selected, manifestDigest: selected.manifestDigest ?? jsonHash(input.archive), revision: binding.revision + 1, updatedAt: now.toISOString() };
  await recordArchiveRevision(tx, binding, next, input, authority, now, acceptedChange);
  return saveArchiveBinding(tx, next);
}
