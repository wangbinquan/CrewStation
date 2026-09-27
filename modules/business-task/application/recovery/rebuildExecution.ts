import type { ServiceId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { ExecutionLifecycle } from '../../domain/executionLifecycle';
import type { BusinessExecutionDeps } from '../execution/dependencies';

/** The worker consumes the immutable request bound in the same transaction as lifecycle admission. */
export async function rebuildRecoveryWorkspace(deps: BusinessExecutionDeps, operation: ExecutionLifecycle) {
  const request = await deps.recoveryRequests?.forOperation(operation.serviceId, operation.id);
  const parent = await deps.operations.forTask(operation.serviceId, operation.taskId);
  if (!request || request.target.action !== 'rebuild-workspace' || request.target.taskId !== operation.taskId || !parent || !deps.environments.rebuildBusinessWorkspace) throw precondition('重建缺少原恢复请求或执行能力', { code: 'recovery_target_mismatch' });
  const image = parent.intent.task.runtimeImage;
  if (image && !await deps.runtimeImages?.inspectReference?.(parent.intent.projectId, { type: 'task', id: operation.taskId }, image)) throw precondition('原运行镜像快照不可恢复', { code: 'original_image_incompatible' });
  return deps.environments.rebuildBusinessWorkspace({ taskId: operation.taskId, projectId: parent.intent.projectId, serviceId: operation.serviceId as ServiceId,
    operationId: operation.id, generation: operation.generation, volumeUid: request.target.volumeUid });
}
