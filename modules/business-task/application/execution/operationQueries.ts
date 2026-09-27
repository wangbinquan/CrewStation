import { notFound } from '@crewstation/kernel';
import type { BusinessExecutionApi } from '../../api/executionApi';
import { messageView } from '../../domain/executionMessage';
import { cancellationView } from '../../domain/executionCancellation';
import { lifecycleView } from '../../domain/executionLifecycle';
import type { BusinessExecutionDeps } from './dependencies';
import { executionSource } from './source';

export function executionOperationQueries(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'getOperation'> {
  const source = executionSource(deps);
  return { getOperation: async (caller, taskId, id) => {
    const context = await source(caller);
    const owned = (operation: { serviceId: string; taskId: string } | undefined) => operation?.serviceId === context.serviceId && operation.taskId === taskId;
    const message = await deps.messages.get(id); if (message && owned(message)) return messageView(message);
    const cancellation = await deps.cancellations.get(id); if (cancellation && owned(cancellation)) return cancellationView(cancellation);
    const lifecycle = await deps.lifecycles.get(id); if (lifecycle && owned(lifecycle)) return lifecycleView(lifecycle);
    const admission = await deps.operations.get(id);
    if (admission?.serviceId === context.serviceId && admission.intent.task.id === taskId) return { operationId: admission.id, taskId, state: admission.state, resourceId: taskId, ...(admission.errorCode ? { message: admission.errorCode } : {}) };
    throw notFound('业务任务操作', id);
  } };
}
