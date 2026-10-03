import type { BusinessRuntimeImages } from '../ports/runtimeImages';
import type { ServiceId, TaskId, TraceId } from '@crewstation/contracts';
import { isPlatformError, precondition } from '@crewstation/kernel';
import type { ExecutionOperation, OperationLease } from '../domain/taskAdmission';
import type { ExecutionOperations } from '../ports/executionOperations';
import type { Environments } from '../ports/runtime';
import type { TaskInputPreparation } from '../ports/storage/taskInputs';
import type { BusinessProjectWork } from '../ports/deletion/work';

export interface TaskAdmissionDispatchDeps { projectWork?: BusinessProjectWork; taskInputs?: TaskInputPreparation; runtimeImages?: BusinessRuntimeImages; operations: ExecutionOperations; environments: Pick<Environments, 'createEnvironment' | 'getEnvironment' | 'restartBusinessWorkspace'> }

/** 固定 taskId 贯穿意图和资源准入；丢回执后先对账，不能把已建资源改成容量拒绝。 */
export async function dispatchTaskAdmission(deps: TaskAdmissionDispatchDeps, operation: ExecutionOperation): Promise<void> {
  if (operation.state !== 'running' || !operation.lease) return;
  const input = { projectId: operation.intent.projectId, serviceId: operation.serviceId, kind: 'task-admission' as const, reference: operation.id, inputDigest: operation.effectiveDigest };
  if (deps.projectWork) return deps.projectWork.run(input, () => dispatch(deps, operation));
  return dispatch(deps, operation);
}
async function dispatch(deps: TaskAdmissionDispatchDeps, operation: ExecutionOperation): Promise<void> {
  const lease = { id: operation.id, owner: operation.lease!.owner, revision: operation.revision };
  const task = operation.intent.task;
  const effect = async <T>(callback: () => Promise<T>) => {
    await deps.projectWork?.checkCurrent(operation.intent.projectId, operation.serviceId);
    const result = await callback();
    await deps.projectWork?.checkCurrent(operation.intent.projectId, operation.serviceId); return result;
  };
  try {
    if (operation.intent.inputObjects) {
      if (!deps.taskInputs) throw precondition('任务对象输入能力未配置');
      await effect(() => deps.taskInputs!.prepare({ projectId: operation.intent.projectId, serviceId: task.serviceId, taskId: task.id, generation: task.generation, items: operation.intent.inputObjects! }));
    }
    if (task.runtimeImage) {
      if (!deps.runtimeImages) throw new Error('任务镜像确认端口尚未配置');
      await effect(() => deps.runtimeImages!.confirmTask(task.runtimeImage!, task.id));
    }
    if (operation.intent.restartOf) {
      if (!deps.environments.restartBusinessWorkspace) throw precondition('重新执行能力未配置', { code: 'unsupported_capability' });
      await effect(() => deps.environments.restartBusinessWorkspace!({ projectId: operation.intent.projectId, serviceId: task.serviceId, taskId: operation.intent.restartOf!.taskId,
        newTaskId: task.id, fingerprint: operation.effectiveDigest, traceId: task.traceId }));
    } else await effect(() => deps.environments.createEnvironment({
      admission: { id: task.id as TaskId, fingerprint: operation.effectiveDigest }, serviceId: task.serviceId as ServiceId, kind: 'business',
      businessStorage: 'isolated-v1', ...(task.runtimeImage ? { runtimeImage: task.runtimeImage } : {}),
      ...(task.completionPolicy === 'archive-and-delete' ? { completionPolicy: task.completionPolicy } : {}),
      ...(operation.intent.inputObjects ? { objectInputsGeneration: task.generation } : {}),
      volumeMode: task.volumeMode, profile: task.taskProfileId, traceId: task.traceId as TraceId, labels: operation.intent.environmentLabels,
    }));
    if (operation.intent.inputObjects) await effect(() => deps.taskInputs!.commit(task.id, task.generation));
    await effect(() => deps.operations.settle(lease, 'succeeded'));
  } catch (error) {
    await deps.projectWork?.checkCurrent(operation.intent.projectId, operation.serviceId);
    await reconcileAdmission(deps, operation, lease, error);
  }
}

async function reconcileAdmission(deps: TaskAdmissionDispatchDeps, operation: ExecutionOperation, lease: OperationLease, error: unknown): Promise<void> {
  const check = () => deps.projectWork?.checkCurrent(operation.intent.projectId, operation.serviceId);
  try {
    await check();
    if (await deps.environments.getEnvironment(operation.intent.task.id as TaskId)) {
      await check();
      if (operation.intent.inputObjects) await deps.taskInputs!.commit(operation.intent.task.id, operation.intent.task.generation);
      await check();
      await deps.operations.settle(lease, 'succeeded');
      return;
    }
  } catch {
    await check();
    // 连存在性也无法证明：保留原句柄，下一轮查询；不向调用方伪报 429 或失败。
    await deps.operations.settle(lease, 'pending', 'admission_unknown');
    return;
  }
  await check();
  if (operation.errorCode === 'admission_unknown') {
    // 上一 worker 的调用可能尚在网络／资源准入临界区；一次不存在查询不能证明它不会迟到成功。
    await deps.operations.settle(lease, 'pending', 'admission_unknown');
  } else if (isPlatformError(error) && error.kind === 'quota_exceeded') {
    if (operation.intent.inputObjects) await deps.taskInputs?.abort(operation.intent.task.id, operation.intent.task.generation, true);
    await deps.operations.settle(lease, 'retryable-rejected', 'quota_exceeded');
  } else if (isPlatformError(error) && ['validation', 'forbidden', 'not_found', 'precondition', 'conflict'].includes(error.kind)) {
    if (operation.intent.inputObjects) await deps.taskInputs?.abort(operation.intent.task.id, operation.intent.task.generation, false);
    await deps.operations.settle(lease, 'failed', operation.intent.restartOf ? String(error.details?.['code'] ?? error.kind) : error.kind);
  } else {
    await deps.operations.settle(lease, 'pending', 'admission_unknown');
  }
}
