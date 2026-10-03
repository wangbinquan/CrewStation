import type { ServiceId } from '@crewstation/contracts';
import type { BusinessExecutionApi } from '../../api/executionApi';
import type { BusinessExecutionDeps } from './dependencies';
import type { ExecutionLifecycle } from '../../domain/executionLifecycle';
import { lifecycleView } from '../../domain/executionLifecycle';
import { isPlatformError, newResourceId, notFound, quotaExceeded } from '@crewstation/kernel';
import { executionSource } from './source';
import { admissionTaskView } from './taskView';
import { releaseClosedTaskImages } from '../taskRuntimeImage';
import { rebuildRecoveryWorkspace } from '../recovery/rebuildExecution';
import { businessExecutionWork } from './deletion/projectWork';

export function executionLifecycleUseCases(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'mutateTask' | 'getOperation'> & { progressLifecycle(): Promise<number> } {
  const source = executionSource(deps);
  const progress = async (id?: string) => {
    const operation = await deps.lifecycles.claim(newResourceId(), id);
    if (!operation) return 0;
    await businessExecutionWork(deps, { serviceId: operation.serviceId, taskId: operation.taskId, kind: 'lifecycle', reference: operation.id, revision: operation.revision }, (scoped) => dispatchLifecycle(scoped, operation)); return 1;
  };
  return {
    mutateTask: async (caller, taskId, action, input) => {
      const context = await source(caller), parent = await deps.operations.forTask(context.serviceId, taskId);
      if (!parent) throw notFound('业务任务', taskId);
      const task = await admissionTaskView(deps, parent);
      const operation = await deps.lifecycles.request(context.serviceId, taskId, action, input, task.state, { source: context.authority, ...(input.fence ? { fence: input.fence } : {}), ...(input.stopAuthority ? { stopAuthority: input.stopAuthority } : {}) });
      if (operation.state === 'pending') await progress(operation.id);
      const result = (await deps.lifecycles.get(operation.id))!;
      if (result.state === 'retryable-rejected') throw quotaExceeded('并发任务额度不足，请使用同一 requestKey 重试', { code: 'quota_exceeded', operationId: result.id, retryAfterSeconds: 1 });
      return lifecycleView(result);
    },
    getOperation: async (caller, taskId, id) => {
      const context = await source(caller), operation = await deps.lifecycles.get(id);
      if (!operation || operation.serviceId !== context.serviceId || operation.taskId !== taskId) throw notFound('业务任务操作', id);
      return lifecycleView(operation);
    },
    progressLifecycle: () => progress(),
  };
}
async function dispatchLifecycle(deps: BusinessExecutionDeps, operation: ExecutionLifecycle): Promise<void> {
  try {
    let env = await deps.environments.getEnvironment(operation.taskId);
    if (!env) {
      if (operation.action === 'rebuild') { await deps.lifecycles.settle(operation, 'failed', 'original_workspace_unavailable'); return; }
      const stopped = operation.action === 'close' && await deps.environments.blockBusinessAdmission?.(operation.serviceId as ServiceId, operation.taskId);
      if (stopped && await releaseClosedTaskImages(deps, operation)) await deps.lifecycles.settle(operation, 'succeeded');
      else await deps.lifecycles.settle(operation, 'pending', 'resource_observation_unavailable');
      return;
    }
    if (operation.action === 'pause' && env.state !== 'paused') env = await deps.environments.pauseEnvironment(operation.taskId);
    if (operation.action === 'resume' && env.state === 'paused') env = await deps.environments.resumeEnvironment(operation.taskId);
    if (operation.action === 'rebuild') env = await rebuildRecoveryWorkspace(deps, operation);
    if (operation.action === 'close' && !['released', 'releasing'].includes(env.state)) env = await deps.environments.releaseEnvironment(operation.taskId, 'business');
    const done = operation.action === 'pause' ? env.state === 'paused' : operation.action === 'close' ? env.state === 'released' : env.state === 'running' && env.connected;
    if (['resume', 'rebuild'].includes(operation.action) && env.state === 'failed') { await deps.lifecycles.settle(operation, 'failed', `${operation.action}_failed`); return; }
    if (done && operation.action === 'close') {
      try {
        if (!await releaseClosedTaskImages(deps, operation)) { await deps.lifecycles.settle(operation, 'pending', 'image_runtime_cleanup_pending'); return; }
      } catch { await deps.lifecycles.settle(operation, 'pending', 'image_reference_cleanup_pending'); return; }
    }
    await deps.lifecycles.settle(operation, done ? 'succeeded' : 'pending');
  } catch (error) {
    if (isPlatformError(error) && error.kind === 'quota_exceeded') await deps.lifecycles.settle(operation, 'retryable-rejected', 'quota_exceeded');
    else if (isPlatformError(error) && ['precondition', 'conflict', 'validation'].includes(error.kind)) await deps.lifecycles.settle(operation, 'failed', String(error.details?.['code'] ?? 'lifecycle_rejected'));
    else await deps.lifecycles.settle(operation, 'pending', 'lifecycle_unknown');
  }
}
