import type { ArchiveReceiptDto } from '@crewstation/contracts';
import { ObjectDigestSchema, TaskIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { ArchiveBindingRepository, ArchiveCompletion } from '../../../ports/archiveBindings';
import type { FinalizationBinding } from '../../../domain/objectStorage';
import { assertSameStorageRequest, assertStorageRevision } from '../../../domain/objectStorage';
import { objectStorageTransaction } from '../objectCatalog';
import { archiveBackendReady, archiveUnfrozen, requireArchiveBinding, saveArchiveBinding } from './bindingState';
import { archiveObjects, archiveReferences } from './references';
import { requireArchivePlan } from './plans';
import { savedArchiveIds, verifyReceiptItems } from './receiptItems';
import { releaseTaskInputs } from '../objects/taskInputs';

function receiptReplay(binding: FinalizationBinding, input: ArchiveCompletion): void {
  assertSameStorageRequest(jsonHash({ receiptId: binding.receipt!.id, disposition: binding.receipt!.disposition, stopProofDigest: binding.stopProofDigest, completionProofDigest: binding.completionProofDigest, items: binding.items }), jsonHash(input));
}
export function archiveReceiptRepository(db: Database): Pick<ArchiveBindingRepository, 'receipt' | 'permitDeletion' | 'reclaimed' | 'confirmLossStops'> {
  return {
    confirmLossStops: (id, revision, evidence) => objectStorageTransaction(db, async (tx, now) => {
      const binding = await requireArchiveBinding(tx, id); assertStorageRevision(binding.revision, revision);
      ObjectDigestSchema.parse(evidence.stopProofDigest); if (evidence.completionProofDigest !== null) ObjectDigestSchema.parse(evidence.completionProofDigest);
      if (binding.receipt?.disposition !== 'loss') throw precondition('当前收据不是经确认的数据损失');
      if (binding.stopProofDigest) {
        assertSameStorageRequest(jsonHash({ stopProofDigest: binding.stopProofDigest, completionProofDigest: binding.completionProofDigest }), jsonHash(evidence)); return binding;
      }
      await archiveUnfrozen(tx, binding);
      return saveArchiveBinding(tx, { ...binding, ...evidence, updatedAt: now.toISOString() });
    }),
    receipt: (id, revision, input) => objectStorageTransaction(db, async (tx, now) => {
      const binding = await requireArchiveBinding(tx, id); await archiveUnfrozen(tx, binding); assertStorageRevision(binding.revision, revision);
      if (binding.receipt) { receiptReplay(binding, input); return binding; }
      if (binding.state !== 'bound') throw precondition('终结操作尚未确认接受归档绑定');
      await archiveBackendReady(tx, binding, now); await verifyReceiptItems(tx, binding, input);
      const receipt: ArchiveReceiptDto = { id: input.receiptId, taskId: TaskIdSchema.parse(binding.taskId), finalizationId: binding.id, finalizationRevision: revision, taskGeneration: binding.taskGeneration,
        volumeUid: binding.volumeUid, manifestDigest: binding.manifestDigest, disposition: input.disposition, itemCount: input.items.length, noArtifactsReason: binding.noArtifactsReason, lossActorId: null, lossReason: null, createdAt: now.toISOString() };
      const ids = savedArchiveIds(input.items);
      const objects = await archiveReferences(tx, binding.spaceId, ids, { type: 'archive-receipt', id: receipt.id, revision: 1 }, 'active', now);
      await archiveReferences(tx, binding.spaceId, ids, { type: 'finalization-guard', id: binding.id, revision }, 'active', now);
      await archiveReferences(tx, binding.spaceId, objects.filter((o) => o.archive?.bindingId === binding.id).map((o) => o.id), { type: 'archive-pending', id: binding.id, revision }, 'released', now);
      if (binding.planId) await archiveReferences(tx, binding.spaceId, (await requireArchivePlan(tx, binding.planId)).pinnedObjectIds, { type: 'archive-pending', id: binding.planId, revision: 1 }, 'released', now);
      return saveArchiveBinding(tx, { ...binding, receipt, items: input.items, stopProofDigest: input.stopProofDigest, completionProofDigest: input.completionProofDigest, state: 'receipted', updatedAt: now.toISOString() });
    }),
    permitDeletion: (id, revision, permitId) => objectStorageTransaction(db, async (tx, now) => {
      ResourceIdSchema.parse(permitId);
      const binding = await requireArchiveBinding(tx, id); assertStorageRevision(binding.revision, revision);
      if (!binding.receipt || !['receipted', 'delete-started'].includes(binding.state)) throw precondition('归档收据尚未提交');
      if (binding.deletePermitId && binding.deletePermitId !== permitId) throw conflict('此终结已有不同的卷清理许可');
      // A backup must drain permits already issued, including a lost reply before runtime got it.
      if (binding.deletePermitId === permitId) return binding;
      await archiveUnfrozen(tx, binding);
      if (!binding.stopProofDigest) throw precondition('执行停止证明尚未确认');
      if (binding.receipt.disposition !== 'loss' || savedArchiveIds(binding.items).length) await archiveBackendReady(tx, binding, now);
      await archiveObjects(tx, binding.spaceId, savedArchiveIds(binding.items));
      return saveArchiveBinding(tx, { ...binding, deletePermitId: permitId, state: 'delete-started', updatedAt: now.toISOString() });
    }),
    reclaimed: (id, permitId, proofId) => objectStorageTransaction(db, async (tx, now) => {
      ResourceIdSchema.parse(proofId);
      const binding = await requireArchiveBinding(tx, id);
      if (binding.deletePermitId !== permitId) throw conflict('卷回收证明不对应已发出的清理许可');
      if (binding.reclaimProofId) { assertSameStorageRequest(binding.reclaimProofId, proofId); return binding; }
      if (binding.state !== 'delete-started') throw precondition('尚未进入卷清理阶段');
      await archiveReferences(tx, binding.spaceId, savedArchiveIds(binding.items), { type: 'finalization-guard', id, revision: binding.revision }, 'released', now);
      await releaseTaskInputs(tx, TaskIdSchema.parse(binding.taskId), now);
      return saveArchiveBinding(tx, { ...binding, reclaimProofId: proofId, state: 'completed', observation: null, updatedAt: now.toISOString() });
    }),
  };
}
