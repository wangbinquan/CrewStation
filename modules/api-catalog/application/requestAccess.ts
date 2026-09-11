import type { Actor, ApiRequestDto, CreateApiRequest, ServiceId } from '@crewstation/contracts';
import { conflict, newId, notFound, precondition } from '@crewstation/kernel';
import type { ApiRequest } from '../domain/apiRequest';
import type { ApiCatalogUseCaseDeps } from './dependencies';
import { requestToDto } from './toDto';

/** 业务申请定向开放的操作：需要服务所属项目的 develop 权限；默认开放无需申请，已授权或已有待审批申请时拒绝重复。 */
export function requestAccessUseCase({ uow, services, projects, clock }: ApiCatalogUseCaseDeps) {
  return async (actor: Actor, serviceId: ServiceId, input: CreateApiRequest): Promise<ApiRequestDto> => {
    const resolved = await services.resolveService(serviceId);
    if (!resolved) throw notFound('服务', serviceId);
    await projects.authorize(actor, resolved.projectId, 'develop');
    const now = clock.now();
    return uow.run(async (scope) => {
      const operation = await scope.operations.getByKey(input.operationKey);
      if (!operation || operation.state !== 'active') throw notFound('操作', input.operationKey);
      if (operation.openPolicy === 'default') throw precondition(`操作 ${operation.key} 默认开放，无需申请`, { operationKey: operation.key });
      if ((await scope.grants.get(serviceId, operation.key))?.state === 'granted') {
        throw conflict(`服务已获得 ${operation.key} 的授权`, { operationKey: operation.key });
      }
      if (await scope.requests.findPending(serviceId, operation.key)) {
        throw conflict(`操作 ${operation.key} 已有待审批的申请`, { operationKey: operation.key });
      }
      const request: ApiRequest = {
        id: newId('req'), serviceId, projectId: resolved.projectId, operationKey: operation.key, state: 'pending',
        ...(input.reason === undefined ? {} : { reason: input.reason }), requestedBy: actor.userId, createdAt: now,
      };
      await scope.requests.insert(request);
      return requestToDto(request);
    });
  };
}
