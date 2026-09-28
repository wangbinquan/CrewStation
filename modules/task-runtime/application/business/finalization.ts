import type { BusinessStorageFinalization, WorkloadStopBarrier } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import { deferWorkspaceRelease } from '../nativeExecution';
import { resolveStorageIdentity, validateStorageFinalization } from './storageIdentity';
export { validateStorageFinalization } from './storageIdentity';
/** Freeze can run before results drain; it must preserve the existing Runner connection for final ACKs. */
export function businessStorageFinalization(deps: TaskRuntimeUseCaseDeps) {
  const freezeBusinessStorage = async (input: BusinessStorageFinalization): Promise<void> => {
    if (!deps.workloadSafety || deps.creation !== 'ledger') throw precondition('工作卷终结屏障不可用');
    if (!await deps.unprovisionedStorage?.freeze(input)) await deps.uow.run(async (scope) => {
      await scope.admissions.lock(input.projectId);
      const env = await scope.environments.getById(input.taskId); validateStorageFinalization(env, input, true);
      if (env.render.storageFinalization?.revision === input.revision) return;
      await scope.environments.update({ ...env, updatedAt: deps.clock.now(), render: { ...env.render, storageFinalization: { operationId: input.operationId, revision: input.revision, volumeUid: input.volumeUid ?? env.businessWorkspace?.volumeUid ?? null } } });
    });
    // Crash between the commits leaves admission more restrictive; replay closes any in-flight grants.
    await deps.workloadSafety.freezeTask(input.taskId, { operationId: input.operationId, revision: input.revision });
  };
  return {
    freezeBusinessStorage,
    resolveBusinessStorage: async (input: BusinessStorageFinalization) => { await freezeBusinessStorage(input); return resolveStorageIdentity(deps, input); },
    /** Called only after business has durably confirmed every attempt's result and session ACK. */
    stopBusinessStorage: async (input: BusinessStorageFinalization): Promise<WorkloadStopBarrier> => {
      await freezeBusinessStorage(input);
      if (await deps.unprovisionedStorage?.owns(input)) return deps.workloadSafety!.scanStopped(input.taskId, { operationId: input.operationId, revision: input.revision }, 'business');
      const env = await deps.uow.run(async (scope) => {
        await scope.admissions.lock(input.projectId);
        const current = await scope.environments.getById(input.taskId); validateStorageFinalization(current, input);
        if (current.render.storageFinalization?.computeStopped) return current;
        return (await deferWorkspaceRelease(scope, current, deps.clock.now(), 'business'))!;
      });
      if (!env.render?.storageFinalization?.computeStopped) return { state: 'pending', count: 0, digest: null, blockedConsumerId: null };
      return deps.workloadSafety!.scanStopped(input.taskId, { operationId: input.operationId, revision: input.revision }, 'business');
    },
  };
}
