import { forbidden, precondition } from '@crewstation/kernel';
import type { BusinessExecutionCaller } from '../../api/executionApi';
import type { ExecutionAuthority } from '../../domain/executionControl';
import type { BusinessExecutionDeps } from './dependencies';

export function executionSource(deps: BusinessExecutionDeps) {
  return async (caller: BusinessExecutionCaller) => {
    const workload = caller.token ? await deps.sources.resolve(caller.token) : undefined;
    if (!workload || workload.identity !== caller.identity || workload.kind !== 'service' || !workload.slot) throw forbidden('缺少有效的服务 Pod 发布身份');
    const service = await deps.directory.resolveServiceIdentity(workload.identity);
    if (!service) throw forbidden('来源服务尚未登记');
    const registration = await deps.uow.read.contracts.forRelease(service.serviceId, workload.source.releaseId);
    if (!registration?.tasksSpec) throw precondition('来源发布尚未登记完整任务契约', { code: 'release_contract_missing' });
    const authority: ExecutionAuthority = { releaseId: workload.source.releaseId, physicalSlot: workload.source.physicalSlot, podUid: workload.source.podUid, ready: workload.source.ready, role: workload.slot };
    return { ...service, workload, authority, registration };
  };
}
