import { executionRunnerTaskId } from '../../domain/executionSubtask';
import { BusinessExecutionReceiptSchema } from '@crewstation/contracts';
import type { ServiceId } from '@crewstation/contracts';
import { newResourceId, notFound } from '@crewstation/kernel';
import type { BusinessExecutionApi } from '../../api/executionApi';
import type { BusinessExecutionDeps } from './dependencies';
import { cancellationView } from '../../domain/executionCancellation';
import type { ExecutionCancellation } from '../../domain/executionCancellation';
import { executionSource } from './source';
import { businessExecutionWork } from './deletion/projectWork';

export function executionCancellationUseCases(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'cancelSubtask'> & { progressCancellation(): Promise<number> } {
  const source = executionSource(deps);
  const progress = async (id?: string) => {
    const operation = await deps.cancellations.claim(newResourceId(), id);
    if (!operation) return 0;
    await businessExecutionWork(deps, { serviceId: operation.serviceId, taskId: operation.taskId, kind: 'cancellation', reference: operation.id, revision: operation.revision }, (scoped) => dispatchCancellation(scoped, operation)); return 1;
  };
  return {
    cancelSubtask: async (caller, taskId, subtaskId, input) => {
      const context = await source(caller);
      if (!await deps.operations.forTask(context.serviceId, taskId)) throw notFound('业务任务', taskId);
      const operation = await deps.cancellations.request(context.serviceId, taskId, subtaskId, input, { source: context.authority, ...(input.fence ? { fence: input.fence } : {}), ...(input.stopAuthority ? { stopAuthority: input.stopAuthority } : {}) });
      if (operation.state === 'pending') await progress(operation.id);
      return cancellationView((await deps.cancellations.get(operation.id))!);
    },
    progressCancellation: () => progress(),
  };
}
async function dispatchCancellation(deps: BusinessExecutionDeps, operation: ExecutionCancellation): Promise<void> {
  try {
    const subtask = await deps.subtasks.get(operation.serviceId, operation.taskId, operation.subtaskId);
    if (!subtask || subtask.view.attempt !== operation.expectedAttempt) throw new Error('cancellation identity changed');
    if (['succeeded', 'failed', 'cancelled'].includes(subtask.view.state)) {
      await deps.cancellations.settle(operation, 'succeeded'); return;
    }
    const env = await deps.environments.getEnvironment(executionRunnerTaskId(subtask));
    if (subtask.runtimeTaskId && !env && await deps.environments.blockBusinessAdmission?.(operation.serviceId as ServiceId, subtask.runtimeTaskId)) {
      const finished = subtask.incarnation ? await deps.cancellations.finishStopped(operation) : await deps.cancellations.finishBeforeStart(operation);
      if (finished) await deps.cancellations.settle(operation, 'succeeded');
      return;
    }
    if (subtask.runtimeTaskId && !subtask.incarnation) {
      if ((!env && !subtask.runtimeDispatched) || env?.native?.state === 'finished' || env?.state === 'released') {
        if (await deps.cancellations.finishBeforeStart(operation)) await deps.cancellations.settle(operation, 'succeeded');
      } else {
        if (env) await deps.environments.releaseEnvironment(env.id, 'business');
        await deps.cancellations.settle(operation, 'pending', 'cancellation_unconfirmed');
      }
      return;
    }
    if (env?.state === 'released') {
      if (await deps.cancellations.finishStopped(operation)) await deps.cancellations.settle(operation, 'succeeded');
      return;
    }
    // Agent runtimes are exclusive to this subtask. A shared command workspace cannot be killed here.
    if (subtask.runtimeTaskId && !env?.connected && env) await deps.environments.releaseEnvironment(env.id, 'business');
    if (!env?.connected || !subtask.incarnation) {
      await deps.cancellations.settle(operation, 'pending', 'cancellation_unconfirmed'); return;
    }
    const receipt = BusinessExecutionReceiptSchema.parse(await deps.runner.sendCommand(executionRunnerTaskId(subtask), {
      id: newResourceId(), type: 'cancelBusinessExecution', executionId: subtask.view.executionId,
      registration: { attempt: subtask.view.attempt, payloadDigest: subtask.payloadDigest, incarnation: subtask.incarnation },
    }));
    if (receipt.executionId !== subtask.view.executionId || receipt.payloadDigest !== subtask.payloadDigest || receipt.attempt !== subtask.view.attempt || receipt.incarnation !== subtask.incarnation) throw new Error('cancellation receipt identity changed');
    // Even a finished receipt is not a complete business result until the durable output watermark closes.
    await deps.cancellations.settle(operation, receipt.phase === 'unknown' ? 'pending' : 'awaiting', receipt.phase === 'unknown' ? 'cancellation_unconfirmed' : undefined);
  } catch { await deps.cancellations.settle(operation, 'pending', 'cancellation_unconfirmed'); }
}
