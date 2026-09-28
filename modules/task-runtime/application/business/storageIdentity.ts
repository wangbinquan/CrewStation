import type { BusinessStorageFinalization } from '@crewstation/contracts';
import { ResourceIdSchema } from '@crewstation/contracts';
import { conflict, notFound, precondition } from '@crewstation/kernel';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import type { TaskEnvironment } from '../../domain/taskEnvironment';

export function validateStorageFinalization(env: TaskEnvironment | undefined, input: BusinessStorageFinalization, allowUnresolved = false): asserts env is TaskEnvironment & { render: NonNullable<TaskEnvironment['render']> } {
  ResourceIdSchema.parse(input.operationId);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw conflict('终结修订无效');
  if (!env || env.projectId !== input.projectId || env.serviceId !== input.serviceId || env.id !== input.taskId) throw notFound('业务工作区', input.taskId);
  if (env.native || env.kind !== 'business' || env.render?.completionPolicy !== 'archive-and-delete') throw precondition('任务未使用归档终结策略');
  const knownUid = env.businessWorkspace?.volumeUid ?? env.render.storageFinalization?.volumeUid ?? null;
  if ((!allowUnresolved || input.volumeUid !== null) && knownUid !== input.volumeUid) throw conflict('终结请求的原工作卷身份已变化', { code: 'workspace_volume_changed' });
  const previous = env.render.storageFinalization;
  if (previous && (previous.operationId !== input.operationId || (!allowUnresolved || input.volumeUid !== null) && previous.volumeUid !== input.volumeUid || input.revision < previous.revision || input.revision > previous.revision + 1)) throw conflict('任务终结操作或修订已变化');
}

/** Resolve once after freezing future provision; an issued create without a target remains ambiguous. */
export async function resolveStorageIdentity(deps: TaskRuntimeUseCaseDeps, input: BusinessStorageFinalization): Promise<string | null> {
  if (!deps.taskVolumes) throw precondition('工作卷身份观测不可用');
  if (await deps.unprovisionedStorage?.owns(input)) return null;
  return deps.uow.run(async (scope) => {
    await scope.admissions.lock(input.projectId);
    const env = await scope.environments.getById(input.taskId); validateStorageFinalization(env, input, true);
    const frozen = env.render.storageFinalization;
    if (!frozen || frozen.operationId !== input.operationId || frozen.revision !== input.revision) throw precondition('工作卷准入尚未冻结');
    const volume = await deps.taskVolumes!.forTask(input.taskId);
    if (volume.provisionIssued && !volume.target && !volume.claim) throw precondition('工作卷创建结果尚未确认，保留供给记录并等待原卷身份', { code: 'workspace_volume_identity_pending' });
    const uid = volume.target?.uid ?? volume.claim?.uid ?? null;
    if ([input.volumeUid, env.businessWorkspace?.volumeUid, frozen.volumeUid].some((known) => known != null && known !== uid)) throw conflict('已记录的原工作卷身份不一致', { code: 'workspace_volume_changed' });
    if (frozen.volumeUid !== uid) await scope.environments.update({ ...env, updatedAt: deps.clock.now(), render: { ...env.render, storageFinalization: { ...frozen, volumeUid: uid } } });
    return uid;
  });
}
