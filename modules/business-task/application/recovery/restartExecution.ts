import type { RestartBusinessTask, TaskId } from '@crewstation/contracts';
import { conflict, jsonHash, newResourceId, notFound, precondition, quotaExceeded } from '@crewstation/kernel';
import type { BusinessExecutionApi } from '../../api/executionApi';
import type { ExecutionOperation, OperationCandidate } from '../../domain/taskAdmission';
import type { BusinessExecutionDeps } from '../execution/dependencies';
import { executionSource } from '../execution/source';
import { admissionTaskView } from '../execution/taskView';
import { admitWithRuntimeImage } from '../taskRuntimeImage';
import { dispatchTaskAdmission } from '../taskAdmissionDispatch';

/** Caller may request only a linked restart; all executable materials come from the original admission. */
export function restartExecutionUseCase(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'restartTask'> {
  const source = executionSource(deps);
  return { restartTask: async (caller, taskId, input) => {
    const context = await source(caller), key = { serviceId: context.serviceId, kind: 'create-task' as const, parentId: taskId, requestKey: input.requestKey };
    const digest = jsonHash({ taskId, expectedGeneration: input.expectedGeneration, recoveryRequestId: input.recovery.recoveryRequestId });
    const authorization = { source: context.authority, fence: input.fence, recovery: input.recovery };
    let operation = await deps.operations.find(key), created = false;
    if (operation) {
      if (operation.requestDigest !== digest) throw conflict('同一 requestKey 已用于不同请求', { code: 'idempotency_conflict' });
      if (operation.state === 'retryable-rejected') operation = await deps.operations.retryRejected(key, digest, authorization);
      else if (operation.state === 'pending') operation = await deps.operations.adoptPending(key, digest, authorization);
    } else {
      const original = await deps.operations.forTask(context.serviceId, taskId);
      if (!original || original.intent.projectId !== context.projectId) throw notFound('原业务任务', taskId);
      const versions = context.registration.tasksSpec?.acceptedTaskContractVersions;
      if (versions && !versions.includes(original.intent.task.taskContractVersion)) throw precondition('当前应用不支持原任务契约', { code: 'task_contract_unsupported' });
      const candidate = restartCandidate(original, input, digest, deps.clock.now());
      const snapshot = candidate.intent.task.runtimeImage;
      if (snapshot) {
        if (!deps.runtimeImages?.restoreTask || !await deps.runtimeImages.inspectReference?.(context.projectId, { type: 'task', id: taskId }, snapshot)) throw precondition('原任务镜像不可恢复', { code: 'original_image_incompatible' });
        await deps.runtimeImages.restoreTask(context.projectId, snapshot, taskId, candidate.intent.task.id);
      }
      const result = await admitWithRuntimeImage(deps.runtimeImages, snapshot, { type: 'task', id: candidate.intent.task.id },
        () => deps.operations.reserve(candidate, authorization), (r) => r.operation.intent.task.id);
      operation = result.operation; created = result.created;
    }
    if (operation.state === 'pending') {
      const claimed = await deps.operations.claim({ id: operation.id, owner: newResourceId(), leaseSeconds: 30 });
      if (claimed) await dispatchTaskAdmission(deps, claimed);
    }
    operation = (await deps.operations.get(operation.id))!;
    if (operation.state === 'retryable-rejected') throw quotaExceeded('额度不足，请使用同一 requestKey 重试', { code: 'quota_exceeded', retryAfterSeconds: 1 });
    if (operation.state === 'failed') throw precondition('重新执行准入失败', { code: operation.errorCode ?? 'admission_failed', taskId: operation.intent.task.id });
    return { task: await admissionTaskView(deps, operation), status: operation.state === 'succeeded' ? (created ? 201 : 200) : 202 };
  } };
}
function restartCandidate(original: ExecutionOperation, input: RestartBusinessTask, requestDigest: string, now: Date): OperationCandidate {
  const taskId = newResourceId() as TaskId, restartOf = { taskId: original.intent.task.id, expectedGeneration: input.expectedGeneration };
  return {
    id: newResourceId(), serviceId: original.serviceId, kind: 'create-task', parentId: restartOf.taskId, requestKey: input.requestKey, requestDigest,
    effectiveDigest: jsonHash({ original: original.effectiveDigest, restartOf, requestDigest }), epoch: input.fence.epoch,
    intent: { ...original.intent, restartOf, task: { ...original.intent.task, id: taskId, state: 'admitting', generation: 1, volumeUid: null, resourceState: 'admitting', quotaHeld: false, createdAt: now.toISOString() } },
  };
}
