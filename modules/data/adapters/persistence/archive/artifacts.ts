import { DeleteArchiveArtifactsSchema } from '@crewstation/contracts';
import { conflict, jsonHash, notFound, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { inArray, sql } from 'drizzle-orm';
import type { ArchiveBindingRepository } from '../../../ports/archiveBindings';
import { objectStorageTransaction, requireObjectSpace, saveObjectSpace } from '../objectCatalog';
import { storedObjects } from '../objectTables';
import { archiveUnfrozen, requireArchiveBinding, saveArchiveBinding } from './bindingState';
import { savedArchiveIds } from './receiptItems';
import { archiveReferences } from './references';

export function deleteArchiveArtifacts(db: Database): ArchiveBindingRepository['deleteArtifacts'] {
  return (id, input, scope) => objectStorageTransaction(db, async (tx, now) => {
    const request = DeleteArchiveArtifactsSchema.parse(input), binding = await requireArchiveBinding(tx, id);
    if (binding.spaceId !== scope.spaceId || binding.taskId !== scope.taskId) throw notFound('任务产物集');
    if (binding.receipt?.id !== request.expectedReceiptId) throw conflict('归档收据已变化');
    const requestDigest = jsonHash({ ...request, actorId: scope.actorId });
    if (binding.artifactsDeletion) {
      if (binding.artifactsDeletion.requestDigest !== requestDigest) throw conflict('任务产物集已经删除');
      return binding.artifactsDeletion.result;
    }
    if (binding.state !== 'completed' || !binding.reclaimProofId) throw precondition('任务存储回收尚未完成，产物仍受保护', { code: 'finalization_artifacts_protected' });
    await archiveUnfrozen(tx, binding);
    const objects = await archiveReferences(tx, binding.spaceId, savedArchiveIds(binding.items), { type: 'archive-receipt', id: binding.receipt.id, revision: 1 }, 'released', now);
    const unreferenced = objects.filter((o) => o.referenceCount === 0 && ['ready', 'degraded'].includes(o.state));
    if (unreferenced.length) {
      const deletion = { requestedAt: now.toISOString(), owner: null, leaseUntil: null, sequence: 0, nextRetryAt: null, errorCode: null };
      await tx.update(storedObjects).set({ state: 'deleting', body: sql`${storedObjects.body} || jsonb_build_object('state','deleting','revision',(${storedObjects.body}->>'revision')::int+1,'deletion',${JSON.stringify(deletion)}::jsonb)` }).where(inArray(storedObjects.id, unreferenced.map((o) => o.id)));
    }
    const size = unreferenced.reduce((n, o) => n + o.size, 0), space = await requireObjectSpace(tx, binding.spaceId);
    await saveObjectSpace(tx, { ...space, usedBytes: space.usedBytes - size, deletingBytes: space.deletingBytes + size });
    const result = { receiptId: binding.receipt.id, deletedAt: now.toISOString(), actorId: scope.actorId, reason: request.reason, objectCount: objects.length, retainedObjectCount: objects.filter((o) => o.referenceCount > 0).length };
    await saveArchiveBinding(tx, { ...binding, artifactsDeletion: { requestDigest, result }, updatedAt: now.toISOString() });
    return result;
  });
}
