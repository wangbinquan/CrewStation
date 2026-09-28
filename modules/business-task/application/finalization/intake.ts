import { notFound, precondition } from '@crewstation/kernel';
import type { BusinessExecutionApi } from '../../api/executionApi';
import type { FinalizationOperations } from '../../ports/storage/finalizations';
import type { FinalizationPreparation } from '../../ports/storage/preparation';
import type { BusinessExecutionDeps } from '../execution/dependencies';
import { executionSource } from '../execution/source';

/** HTTP authority selects a service; all storage identities come from module owners. */
export function finalizationIntake(deps: BusinessExecutionDeps, store: FinalizationOperations, ports?: FinalizationPreparation): Pick<BusinessExecutionApi, 'finalize' | 'finalization'> {
  const source = executionSource(deps);
  return {
    finalize: async (caller, taskId, input) => {
      const context = await source(caller), previous = await store.forTask(context.serviceId, taskId);
      const authorization = { source: context.authority, fence: input.fence, stopAuthority: input.stopAuthority };
      // Replays compare the original digest inside the journal, even after plan binding or lease expiry.
      if (previous) return (await store.accept(context.serviceId, taskId, input, { spaceId: previous.spaceId, volumeUid: previous.volumeUid, authorization })).view;
      if (!await deps.operations.forTask(context.serviceId, taskId)) throw notFound('业务任务');
      if (!ports?.preflight) throw precondition('归档终结能力尚未就绪', { code: 'finalization_unavailable' });
      const { spaceId } = await ports.preflight(caller, taskId, input.archive);
      const environment = await deps.environments.getEnvironment(taskId);
      if (environment && environment.projectId !== context.projectId) throw notFound('业务任务');
      const volumeUid = environment?.businessWorkspace?.volumeUid ?? null;
      return (await store.accept(context.serviceId, taskId, input, { spaceId, volumeUid, authorization })).view;
    },
    finalization: async (caller, taskId) => {
      const context = await source(caller), operation = await store.forTask(context.serviceId, taskId);
      if (!operation) throw notFound('终结操作');
      return operation.view;
    },
  };
}
