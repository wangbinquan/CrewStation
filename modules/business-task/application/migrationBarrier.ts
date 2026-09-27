import type { TaskId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { BusinessReleaseHandoff } from '../api/releaseHandoff';
import type { BusinessExecutionDeps } from './execution/dependencies';

export function migrationBarrier(deps: BusinessExecutionDeps): Pick<BusinessReleaseHandoff, 'migrationBarrier'> {
  return {
    migrationBarrier: async (serviceId, request) => {
      const registration = await deps.uow.read.contracts.forRelease(serviceId, request.expectedActiveReleaseId);
      if (registration?.tasksSpec?.executionControl !== 'fenced') throw precondition('当前应用未启用 fenced 停写协议，不能证明迁移安全');
      const { control } = await deps.controls.freezeMigration(serviceId, request);
      const blocked: string[] = [];
      if (!await deps.controls.quiescent(serviceId)) blocked.push('dispatch_in_flight');
      if (!control?.migration?.preparationDigest) blocked.push('application_write_barrier_missing');
      for (const id of await deps.controls.writerRuntimes(serviceId)) {
        const env = await deps.environments.getEnvironment(id as TaskId);
        if (!env || !['paused', 'released'].includes(env.state)) blocked.push(id);
      }
      return { ready: blocked.length === 0, epoch: control!.epoch, blocked,
        ...(control?.migration?.preparationDigest ? { preparationDigest: control.migration.preparationDigest } : {}) };
    },
  };
}
