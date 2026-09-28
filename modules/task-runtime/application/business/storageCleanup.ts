import { DomainTopic } from '@crewstation/contracts';
import { conflict, precondition } from '@crewstation/kernel';
import type { BusinessStorageFinalization } from '@crewstation/contracts';
import type { StorageCleanupApi } from '../../api/storageCleanup';
import type { ArchiveExecutionApi } from '../../api/archiveExecution';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import { validateStorageFinalization } from './finalization';
import { transition } from '../../domain/taskEnvironment';

export function businessStorageCleanup(deps: TaskRuntimeUseCaseDeps, archive: ArchiveExecutionApi): StorageCleanupApi {
  const context = async (input: BusinessStorageFinalization) => {
    if (await deps.unprovisionedStorage?.owns(input)) {
      if (!deps.taskVolumes || !deps.workloadSafety) throw precondition('未供给任务的资源屏障不可用');
      return deps.taskVolumes.forTask(input.taskId);
    }
    const env = await deps.uow.read.environments.getById(input.taskId); validateStorageFinalization(env, input);
    if (!env.render.storageFinalization?.computeStopped || !deps.taskVolumes || !deps.workloadSafety) throw precondition('任务停止与存储回收能力尚未齐备');
    return deps.taskVolumes.forTask(input.taskId);
  };
  return {
    prepare: async (input) => {
      const volume = await context(input);
      if (volume.claim && !volume.target && !volume.permit) {
        await archive.ensure(input, 'binding');
        return { state: 'pending', count: 1, digest: null, blockedConsumerId: null };
      }
      if (!await archive.stop(input)) return { state: 'pending', count: 0, digest: null, blockedConsumerId: null };
      const fence = { operationId: input.operationId, revision: input.revision };
      await deps.workloadSafety!.sealConsumers(input.taskId, fence);
      return deps.workloadSafety!.scanStopped(input.taskId, fence, 'all');
    },
    release: async (input, permit) => {
      const volume = await context(input);
      if (permit.taskId !== input.taskId || permit.operationId !== input.operationId || permit.revision !== input.revision || permit.volumeUid !== input.volumeUid) throw conflict('删除许可与终结操作不符');
      await deps.taskVolumes!.permitDeletion(volume.resourceId, permit);
    },
    proof: async (input) => (await context(input)).proof,
    complete: async (input, proofId) => {
      const volume = await context(input);
      if (!volume.proof || volume.proof.id !== proofId || volume.permit?.operationId !== input.operationId || volume.permit.revision !== input.revision) throw precondition('原工作卷回收尚未持久确认');
      if (deps.unprovisionedStorage && await deps.unprovisionedStorage.owns(input)) { await deps.unprovisionedStorage.complete(input, proofId); return; }
      await deps.uow.run(async (scope) => {
        await scope.admissions.lock(input.projectId);
        const env = await scope.environments.getById(input.taskId); validateStorageFinalization(env, input);
        if (env.state === 'released') return;
        const now = deps.clock.now();
        await scope.environments.update(transition(env, 'released', now, { release: undefined, message: '任务产物已归档，原工作卷已回收' }));
        await scope.events.publish(DomainTopic.taskReleased, { occurredAt: now.toISOString(), traceId: env.traceId, projectId: env.projectId, taskId: env.id, kind: env.kind, reason: 'business' });
      });
    },
  };
}
