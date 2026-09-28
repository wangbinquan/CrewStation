import type { ArchiveReceiptDto } from '@crewstation/contracts';
import { ArchiveLossPageQuerySchema, ConfirmFinalizationLossSchema, TaskIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { ArchiveLossRepository } from '../../../ports/archiveLoss';
import { assertSameStorageRequest, assertStorageRevision } from '../../../domain/objectStorage';
import { objectStorageTransaction } from '../objectCatalog';
import { archiveUnfrozen, requireArchiveBinding, saveArchiveBinding } from './bindingState';
import { archiveLossSnapshot } from './lossSnapshot';
import { archiveReferences } from './references';
import { requireArchivePlan } from './plans';
import { savedArchiveIds } from './receiptItems';

export function archiveLossRepository(db: Database): ArchiveLossRepository {
  return {
    assess: (id, revision, input) => objectStorageTransaction(db, async (tx) => {
      const page = ArchiveLossPageQuerySchema.parse(input), binding = await requireArchiveBinding(tx, id); assertStorageRevision(binding.revision, revision);
      if (binding.receipt || binding.state !== 'bound') throw precondition('当前归档阶段不可确认数据损失', { code: 'archive_loss_unavailable' });
      const snapshot = await archiveLossSnapshot(tx, binding), end = Math.min(snapshot.items.length, page.offset + page.limit);
      return { operationId: id, revision, taskId: binding.taskId, spaceId: binding.spaceId, volumeUid: binding.volumeUid, assessmentDigest: snapshot.digest,
        items: snapshot.items.slice(page.offset, end), itemCount: snapshot.items.length, lostCount: snapshot.items.filter((item) => item.item.state === 'lost').length,
        savedCount: snapshot.items.filter((item) => item.item.state === 'saved').length, nextOffset: end < snapshot.items.length ? end : null };
    }),
    confirm: (id, actorId, input, dataDigest) => objectStorageTransaction(db, async (tx, now) => {
      const request = ConfirmFinalizationLossSchema.parse(input), digest = jsonHash({ actorId, request }), binding = await requireArchiveBinding(tx, id);
      if (binding.loss) { assertSameStorageRequest(binding.loss.requestDigest, digest); return binding.receipt!; }
      await archiveUnfrozen(tx, binding); assertStorageRevision(binding.revision, request.expectedRevision);
      if (binding.state !== 'bound' || binding.receipt) throw precondition('正常收据或清单修订已先完成，不能改写为损失', { code: 'archive_loss_unavailable' });
      const snapshot = await archiveLossSnapshot(tx, binding);
      if (!dataDigest || dataDigest !== snapshot.digest) throw precondition('归档文件或引用已变化，请重新审视损失范围', { code: 'archive_loss_assessment_changed' });
      const items = snapshot.items.map((entry) => entry.item), ids = savedArchiveIds(items);
      const receipt: ArchiveReceiptDto = { id: binding.id, taskId: TaskIdSchema.parse(binding.taskId), finalizationId: id, finalizationRevision: binding.revision, taskGeneration: binding.taskGeneration,
        volumeUid: binding.volumeUid, manifestDigest: binding.manifestDigest, disposition: 'loss', itemCount: items.length, noArtifactsReason: binding.noArtifactsReason, lossActorId: actorId, lossReason: request.reason, createdAt: now.toISOString() };
      const objects = await archiveReferences(tx, binding.spaceId, ids, { type: 'archive-receipt', id: receipt.id, revision: 1 }, 'active', now);
      await archiveReferences(tx, binding.spaceId, ids, { type: 'finalization-guard', id, revision: binding.revision }, 'active', now);
      await archiveReferences(tx, binding.spaceId, objects.filter((o) => o.archive?.bindingId === id).map((o) => o.id), { type: 'archive-pending', id, revision: binding.revision }, 'released', now);
      if (binding.planId) await archiveReferences(tx, binding.spaceId, (await requireArchivePlan(tx, binding.planId)).pinnedObjectIds, { type: 'archive-pending', id: binding.planId, revision: 1 }, 'released', now);
      await saveArchiveBinding(tx, { ...binding, items, receipt, state: 'receipted', loss: { requestKey: request.requestKey, requestDigest: digest, assessmentDigest: snapshot.digest }, updatedAt: now.toISOString() });
      return receipt;
    }),
  };
}
