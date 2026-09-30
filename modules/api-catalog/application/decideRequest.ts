import type { Actor, ApiRequestDto, DecideApiRequest, ServiceId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { forbidden, notFound } from '@crewstation/kernel';
import { grantOperation, revokeGrant } from '../domain/apiGrant';
import { decideRequest } from '../domain/apiRequest';
import type { ApiCatalogUseCaseDeps } from './dependencies';
import { requestToDto } from './toDto';

/** 管理员审批与撤销：授权变化在同一事务内发布 api-catalog.grant-changed，gateway 据此重新生成放行表。 */
export function grantUseCases({ uow, clock, projects, services }: ApiCatalogUseCaseDeps) {
  return {
    decideRequest: async (actor: Actor, requestId: string, input: DecideApiRequest): Promise<ApiRequestDto> => {
      if (!await projects.isAdmin(actor.userId)) throw forbidden('只有管理员可以审批 API 申请');
      const initial = await uow.read.requests.getById(requestId);
      if (!initial) throw notFound('申请', requestId);
      if (input.approve && await projects.authorize({ userId: initial.requestedBy, isAdmin: false }, initial.projectId, 'request-resources') !== 'owner') throw forbidden('申请人已不是项目负责人');
      if (input.approve && !await projects.resourceRequestable?.(actor, initial.projectId, { resourceType: 'api-operation', resourceId: initial.operationId, action: 'grant' })) throw forbidden('目录已撤回此接口的申请资格');
      const now = clock.now();
      return uow.run(async (scope) => {
        const initial = await scope.requests.getById(requestId);
        if (!initial) throw notFound('申请', requestId);
        await scope.allocations.bindService(initial.serviceId, initial.projectId);
        await scope.allocations.lock(initial.serviceId);
        const request = await scope.requests.getById(requestId);
        if (!request) throw notFound('申请', requestId);
        const decided = decideRequest(request, input.approve, actor.userId, input.decision, now);
        await scope.requests.update(decided);
        if (input.approve) {
          await scope.grants.upsert(grantOperation(request.serviceId, request.operationId, actor.userId, now));
          await scope.events.publish(DomainTopic.grantChanged, { occurredAt: now.toISOString(), serviceId: request.serviceId, operationId: request.operationId, state: 'granted' });
        }
        return requestToDto(decided);
      });
    },
    revokeGrant: async (actor: Actor, serviceId: ServiceId, operationId: string): Promise<void> => {
      if (!await projects.isAdmin(actor.userId)) throw forbidden('只有管理员可以撤销授权');
      const service = await services.resolveService(serviceId); if (!service) throw notFound('服务', serviceId);
      const now = clock.now();
      await uow.run(async (scope) => {
        await scope.allocations.bindService(serviceId, service.projectId);
        await scope.allocations.lock(serviceId);
        const existing = await scope.grants.get(serviceId, operationId);
        if (!existing || existing.state !== 'granted') throw notFound('授权', operationId);
        await scope.grants.upsert(revokeGrant(existing, now));
        await scope.events.publish(DomainTopic.grantChanged, { occurredAt: now.toISOString(), serviceId, operationId, state: 'revoked' });
      });
    },
  };
}
