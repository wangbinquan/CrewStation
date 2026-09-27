import type { ServiceId, TaskId } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';

/** Serialize a permanent fixed-ID tombstone with admission. Absence alone is never a stop proof. */
export function blockBusinessAdmission(deps: TaskRuntimeUseCaseDeps) {
  return async (serviceId: ServiceId, taskId: TaskId): Promise<boolean> => {
    if (deps.creation !== 'ledger') throw precondition('准入取消屏障需要资源台账模式');
    const service = await deps.services.resolveServiceById(serviceId);
    if (!service) throw notFound('服务', serviceId);
    return deps.uow.run(async (scope) => {
      await scope.admissions.lock(service.projectId);
      const env = await scope.environments.getById(taskId);
      if (env) {
        if (env.serviceId !== serviceId || env.kind !== 'business') throw precondition('准入身份不属于该业务服务');
        return env.state === 'released';
      }
      await scope.admissions.block(taskId, serviceId);
      return true;
    });
  };
}
