import type { BusinessRuntimeImages } from '../ports/runtimeImages';
import type { ServiceId, TaskId, TraceId } from '@crewstation/contracts';
import { isPlatformError, precondition } from '@crewstation/kernel';
import type { ExecutionOperation, OperationLease } from '../domain/taskAdmission';
import type { ExecutionOperations } from '../ports/executionOperations';
import type { Environments } from '../ports/runtime';

export interface TaskAdmissionDispatchDeps { runtimeImages?: BusinessRuntimeImages; operations: ExecutionOperations; environments: Pick<Environments, 'createEnvironment' | 'getEnvironment' | 'restartBusinessWorkspace'> }

/** 固定 taskId 贯穿意图和资源准入；丢回执后先对账，不能把已建资源改成容量拒绝。 */
export async function dispatchTaskAdmission(deps: TaskAdmissionDispatchDeps, operation: ExecutionOperation): Promise<void> {
  if (operation.state !== 'running' || !operation.lease) return;
  const lease = { id: operation.id, owner: operation.lease.owner, revision: operation.revision };
  const task = operation.intent.task;
  try {
    if (task.runtimeImage) {
      if (!deps.runtimeImages) throw new Error('任务镜像确认端口尚未配置');
      await deps.runtimeImages.confirmTask(task.runtimeImage, task.id);
    }
    if (operation.intent.restartOf) {
      if (!deps.environments.restartBusinessWorkspace) throw precondition('重新执行能力未配置', { code: 'unsupported_capability' });
      await deps.environments.restartBusinessWorkspace({ projectId: operation.intent.projectId, serviceId: task.serviceId, taskId: operation.intent.restartOf.taskId,
        newTaskId: task.id, fingerprint: operation.effectiveDigest, traceId: task.traceId });
    } else await deps.environments.createEnvironment({
      admission: { id: task.id as TaskId, fingerprint: operation.effectiveDigest }, serviceId: task.serviceId as ServiceId, kind: 'business',
      businessStorage: 'isolated-v1', ...(task.runtimeImage ? { runtimeImage: task.runtimeImage } : {}),
      volumeMode: task.volumeMode, profile: task.taskProfileId, traceId: task.traceId as TraceId, labels: operation.intent.environmentLabels,
    });
    await deps.operations.settle(lease, 'succeeded');
  } catch (error) {
    await reconcileAdmission(deps, operation, lease, error);
  }
}

async function reconcileAdmission(deps: TaskAdmissionDispatchDeps, operation: ExecutionOperation, lease: OperationLease, error: unknown): Promise<void> {
  try {
    if (await deps.environments.getEnvironment(operation.intent.task.id as TaskId)) {
      await deps.operations.settle(lease, 'succeeded');
      return;
    }
  } catch {
    // 连存在性也无法证明：保留原句柄，下一轮查询；不向调用方伪报 429 或失败。
    await deps.operations.settle(lease, 'pending', 'admission_unknown');
    return;
  }
  if (operation.errorCode === 'admission_unknown') {
    // 上一 worker 的调用可能尚在网络／资源准入临界区；一次不存在查询不能证明它不会迟到成功。
    await deps.operations.settle(lease, 'pending', 'admission_unknown');
  } else if (isPlatformError(error) && error.kind === 'quota_exceeded') {
    await deps.operations.settle(lease, 'retryable-rejected', 'quota_exceeded');
  } else if (isPlatformError(error) && ['validation', 'forbidden', 'not_found', 'precondition', 'conflict'].includes(error.kind)) {
    await deps.operations.settle(lease, 'failed', operation.intent.restartOf ? String(error.details?.['code'] ?? error.kind) : error.kind);
  } else {
    await deps.operations.settle(lease, 'pending', 'admission_unknown');
  }
}
