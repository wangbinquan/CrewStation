import { admitWithRuntimeImage, bindTaskRuntimeImage } from '../taskRuntimeImage';
import { conflict, newResourceId, notFound, precondition, quotaExceeded } from '@crewstation/kernel';
import type { BusinessExecutionApi } from '../../api/executionApi';
import { admissionTrace, taskAdmissionCandidate, taskRequestDigest } from '../taskAdmissionIntent';
import { dispatchTaskAdmission } from '../taskAdmissionDispatch';
import type { BusinessExecutionDeps } from './dependencies';
import { executionSource } from './source';
import { admissionTaskView } from './taskView';

export function executionTaskUseCases(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'createTask' | 'getTask' | 'runOnce'> {
  const source = executionSource(deps);
  const progress = async (id?: string): Promise<boolean> => {
    const claimed = await deps.operations.claim({ ...(id ? { id } : {}), owner: newResourceId(), leaseSeconds: 30 });
    if (!claimed) return false;
    await dispatchTaskAdmission(deps, claimed);
    return true;
  };
  return {
    createTask: async (caller, input, traceHeader) => {
      const context = await source(caller), traceId = admissionTrace(input.traceId, traceHeader), digest = taskRequestDigest(input);
      const key = { serviceId: context.serviceId, kind: 'create-task' as const, parentId: '', requestKey: input.requestKey };
      const authorization = { source: context.authority, ...(input.fence ? { fence: input.fence } : {}) };
      let operation = await deps.operations.find(key), created = false;
      if (operation) {
        if (operation.requestDigest !== digest) throw conflict('同一 requestKey 已用于不同请求', { code: 'idempotency_conflict' });
        if (operation.state === 'retryable-rejected') operation = await deps.operations.retryRejected(key, digest, authorization);
        else if (operation.state === 'pending' && input.fence) operation = await deps.operations.adoptPending(key, digest, authorization);
      } else {
        if (!context.authority.ready) throw precondition('来源 Pod 尚未就绪', { code: 'source_not_ready' });
        const candidate = taskAdmissionCandidate({ ...context, identity: context.workload.identity, project: context.workload.project, service: context.workload.service, epoch: input.fence?.epoch ?? null }, context.registration, input, traceId, deps.clock.now());
        const bound = await bindTaskRuntimeImage(candidate, deps.runtimeImages, input.runtimeImageVersionId);
        const reserved = await admitWithRuntimeImage(deps.runtimeImages, bound.intent.task.runtimeImage, { type: 'task', id: bound.intent.task.id },
          () => deps.operations.reserve(bound, authorization), (result) => result.operation.intent.task.id);
        operation = reserved.operation; created = reserved.created;
      }
      if (operation.state === 'pending') await progress(operation.id);
      operation = (await deps.operations.get(operation.id))!;
      if (operation.state === 'retryable-rejected') throw quotaExceeded('并发任务额度不足，请使用同一 requestKey 重试', { code: 'quota_exceeded', retryAfterSeconds: 1 });
      if (operation.state === 'failed') throw precondition('任务准入失败', { code: operation.errorCode ?? 'admission_failed', taskId: operation.intent.task.id });
      return { task: await admissionTaskView(deps, operation), status: operation.state === 'succeeded' ? (created ? 201 : 200) : 202 };
    },
    getTask: async (caller, taskId) => {
      const context = await source(caller);
      const operation = await deps.operations.forTask(context.serviceId, taskId);
      if (!operation) throw notFound('业务任务', taskId);
      return admissionTaskView(deps, operation);
    },
    runOnce: async () => {
      let count = 0;
      // 有界推进，失败不堵塞后台线程；单个未知操作一轮只认领一次。
      if (await progress()) count++;
      for (const candidate of await deps.projection.taskObservations()) {
        try {
          const view = await admissionTaskView(deps, candidate.operation);
          if (view.resourceState !== 'unknown' && await deps.projection.observeTask(candidate, view.state)) count++;
        } catch { deps.logger.debug('business task observation deferred', { taskId: candidate.operation.intent.task.id }); }
      }
      return count;
    },
  };
}
