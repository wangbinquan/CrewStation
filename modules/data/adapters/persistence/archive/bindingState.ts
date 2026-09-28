import { eq } from 'drizzle-orm';
import { notFound, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import type { FinalizationArchive } from '@crewstation/contracts';
import type { FinalizationBinding } from '../../../domain/objectStorage';
import { assertSameStorageRequest, assertStorageRevision } from '../../../domain/objectStorage';
import { finalizationBindings } from '../objectTables';
import { assertObjectStorageUnfrozen, requireObjectBackend, requireObjectSpace } from '../objectCatalog';
import { requireArchivePlan, saveArchivePlan } from './plans';
import { archiveObjects, archiveReferences } from './references';

export async function requireArchiveBinding(tx: Executor, id: string): Promise<FinalizationBinding> {
  const binding = (await tx.select().from(finalizationBindings).where(eq(finalizationBindings.id, id)))[0]?.body;
  if (!binding) throw notFound('终结归档绑定'); return binding;
}
export async function saveArchiveBinding(tx: Executor, binding: FinalizationBinding): Promise<FinalizationBinding> {
  await tx.update(finalizationBindings).set({ body: binding, state: binding.state }).where(eq(finalizationBindings.id, binding.id)); return binding;
}
export async function archiveUnfrozen(tx: Executor, binding: Pick<FinalizationBinding, 'spaceId'>): Promise<void> {
  await assertObjectStorageUnfrozen(tx, (await requireObjectSpace(tx, binding.spaceId)).backendId);
}
export async function archiveBackendReady(tx: Executor, binding: FinalizationBinding, now: Date): Promise<void> {
  const space = await requireObjectSpace(tx, binding.spaceId), backend = await requireObjectBackend(tx, space.backendId);
  if (backend.state === 'offline' || backend.health !== 'ready' || !backend.observedAt || now.getTime() - Date.parse(backend.observedAt) > 120_000) throw precondition('对象后端健康未确认，保留任务工作卷', { code: 'archive_backend_unavailable' });
}
export async function selectArchivePlan(tx: Executor, spaceId: string, taskId: string, archive: FinalizationArchive) {
  if ('noArtifactsReason' in archive) return { planId: null, planRevision: null, manifestDigest: null, noArtifactsReason: archive.noArtifactsReason };
  const plan = await requireArchivePlan(tx, archive.planId);
  if (plan.spaceId !== spaceId || plan.taskId !== taskId) throw notFound('归档清单');
  assertStorageRevision(plan.revision, archive.planRevision); assertSameStorageRequest(plan.digest ?? '', archive.digest);
  if (plan.state !== 'sealed') throw precondition('归档清单尚未封存或已被占用', { code: 'archive_manifest_unavailable' });
  await archiveObjects(tx, plan.spaceId, plan.pinnedObjectIds);
  await saveArchivePlan(tx, { ...plan, state: 'bound' });
  return { planId: plan.id, planRevision: plan.revision, manifestDigest: plan.digest!, noArtifactsReason: null };
}
export async function retireArchivePlan(tx: Executor, binding: FinalizationBinding, now: Date, release: boolean): Promise<void> {
  if (!binding.planId) return;
  const plan = await requireArchivePlan(tx, binding.planId);
  if (release) await archiveReferences(tx, plan.spaceId, plan.pinnedObjectIds, { type: 'archive-pending', id: plan.id, revision: 1 }, 'released', now);
  await saveArchivePlan(tx, { ...plan, state: release ? 'aborted' : 'sealed' });
}
