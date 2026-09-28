import type { AcceptedArchiveFinalization, AcceptedArchiveRevision } from '@crewstation/contracts';
import { conflict, jsonHash, notFound } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { and, eq, ne } from 'drizzle-orm';
import type { FinalizationBinding } from '../../../domain/objectStorage';
import { finalizationBindings } from '../objectTables';

/** A requested operation may have lost its sealed plan before the binding handshake. Repair is atomic with R2. */
export async function revisionBinding(tx: Executor, change: AcceptedArchiveRevision, original: AcceptedArchiveFinalization | undefined, now: Date): Promise<FinalizationBinding> {
  const existing = (await tx.select().from(finalizationBindings).where(eq(finalizationBindings.id, change.finalizationId)))[0]?.body;
  if (existing) return existing;
  if (!original || original.id !== change.finalizationId || original.projectId !== change.projectId || original.serviceId !== change.serviceId || original.taskId !== change.taskId || original.spaceId !== change.spaceId) throw notFound('已受理原始终结意图');
  if (change.input.expectedRevision !== 1 || change.input.expectedGeneration !== original.taskGeneration) throw conflict('未绑定终结修订不匹配');
  if ((await tx.select({ id: finalizationBindings.id }).from(finalizationBindings).where(and(eq(finalizationBindings.taskId, original.taskId), ne(finalizationBindings.state, 'aborted'))).limit(1)).length) throw conflict('任务已有其他终结绑定');
  const { projectId: _project, serviceId: _service, archive, ...identity } = original;
  const binding: FinalizationBinding = { ...identity, revision: 1, requestDigest: jsonHash({ ...identity, archive }), state: 'bound', receipt: null, items: [],
    planId: 'planId' in archive ? archive.planId : null, planRevision: 'planId' in archive ? archive.planRevision : null,
    manifestDigest: 'digest' in archive ? archive.digest : jsonHash(archive), noArtifactsReason: 'noArtifactsReason' in archive ? archive.noArtifactsReason : null,
    stopProofDigest: null, completionProofDigest: null, deletePermitId: null, reclaimProofId: null, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  await tx.insert(finalizationBindings).values({ id: binding.id, taskId: binding.taskId, spaceId: binding.spaceId, state: binding.state, body: binding });
  return binding;
}
