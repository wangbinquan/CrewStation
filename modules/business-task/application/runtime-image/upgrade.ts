import type { RuntimeImageSelection, ServiceId } from '@crewstation/contracts';
import { isPlatformError, precondition, validation } from '@crewstation/kernel';
import type { ExecutionLifecycle } from '../../domain/executionLifecycle';
import { currentTaskRuntimeImage } from '../../domain/executionLifecycle';
import type { RuntimeImageUpgradeRequest } from '../../ports/executionLifecycle';
import type { BusinessExecutionDeps } from '../execution/dependencies';

/** RFC-043: the caller release's task selection decides the target, by the same rule as task creation. */
export function runtimeImageUpgradeRequest(spec: RuntimeImageSelection, requested: string | undefined): RuntimeImageUpgradeRequest {
  const selection: RuntimeImageSelection = { ...(spec.runtimeImageVersionId ? { runtimeImageVersionId: spec.runtimeImageVersionId } : {}), ...(spec.allowedRuntimeImageVersionIds ? { allowedRuntimeImageVersionIds: spec.allowedRuntimeImageVersionIds } : {}) };
  if (requested !== undefined && requested !== selection.runtimeImageVersionId && !selection.allowedRuntimeImageVersionIds?.includes(requested)) throw validation('指定镜像不在发布的任务镜像允许集合内', { code: 'runtime_image_not_allowed', versionId: requested });
  const targetVersionId = requested ?? selection.runtimeImageVersionId;
  if (!targetVersionId) throw precondition('发布未声明任务运行镜像，请显式指定目标版本', { code: 'runtime_image_missing' });
  return { kind: 'runtime-image', targetVersionId, requestedVersionId: requested ?? null, selection };
}

/**
 * Same image, validated for task usage, reserved and confirmed; then the paused workspace is repinned and the pin recorded,
 * and only then is the replaced reference released. Each step replays: reservation and repin are keyed by the task and operation.
 */
export async function dispatchRuntimeImageUpgrade(deps: BusinessExecutionDeps, operation: ExecutionLifecycle): Promise<void> {
  const upgrade = operation.payload, images = deps.runtimeImages, repin = deps.environments.repinPausedBusinessWorkspace, owner = { type: 'task' as const, id: operation.taskId };
  const parent = await deps.operations.forTask(operation.serviceId, operation.taskId);
  if (!upgrade || !parent) throw precondition('升级操作缺少原任务或目标版本', { code: 'runtime_image_missing' });
  if (!images?.versionImage || !images.release || !repin) throw precondition('平台尚未提供运行镜像升级能力', { code: 'unsupported_capability' });
  const projectId = parent.intent.projectId;
  const pinned = currentTaskRuntimeImage(parent.intent.task.runtimeImage, await deps.lifecycles.read(operation.serviceId, operation.taskId));
  if (pinned?.versionId !== upgrade.targetVersionId) {
    const [from, to] = await Promise.all([images.versionImage(projectId, upgrade.fromVersionId), images.versionImage(projectId, upgrade.targetVersionId)]);
    if (!from || !to || from.imageId !== to.imageId) throw precondition('目标版本不属于任务当前的运行镜像', { code: 'runtime_image_mismatch' });
    if (to.state !== 'available') throw precondition('目标运行镜像版本当前不可用', { code: 'image_unavailable' });
    const snapshot = await images.reserveTask(projectId, operation.taskId, upgrade.selection, upgrade.requestedVersionId ?? undefined);
    if (snapshot?.versionId !== upgrade.targetVersionId) throw precondition('目标运行镜像版本未解析', { code: 'runtime_image_missing' });
    try {
      await images.confirmTask(snapshot, operation.taskId);
      await repin({ projectId, serviceId: operation.serviceId as ServiceId, taskId: operation.taskId, operationId: operation.id, generation: operation.generation, runtimeImage: snapshot });
    } catch (error) {
      // An explicit rejection keeps the original pin, so the reference that never became current goes back.
      if (isPlatformError(error) && ['precondition', 'conflict', 'validation'].includes(error.kind)) await images.release(snapshot, owner);
      throw error;
    }
    // A lost claim leaves recording to the next owner, which replays the same reservation and repin.
    if (!await deps.lifecycles.recordRuntimeImage(operation, snapshot)) return;
  }
  await images.release({ versionId: upgrade.fromVersionId }, owner);
  await deps.lifecycles.settle(operation, 'succeeded');
}
