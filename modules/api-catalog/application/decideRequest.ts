import type { Actor, ApiRequestDto, DecideApiRequest, ServiceId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { forbidden, notFound } from '@crewstation/kernel';
import { grantOperation, revokeGrant } from '../domain/apiGrant';
import { decideRequest } from '../domain/apiRequest';
import type { ApiCatalogUseCaseDeps } from './dependencies';
import { requestToDto } from './toDto';

/** 管理员审批与撤销：授权变化在同一事务内发布 api-catalog.grant-changed，gateway 据此重新生成放行表。 */
export function grantUseCases({ uow, clock }: ApiCatalogUseCaseDeps) {
  return {
    decideRequest: async (actor: Actor, requestId: string, input: DecideApiRequest): Promise<ApiRequestDto> => {
      if (!actor.isAdmin) throw forbidden('只有管理员可以审批 API 申请');
      const now = clock.now();
      return uow.run(async (scope) => {
        const request = await scope.requests.getById(requestId);
        if (!request) throw notFound('申请', requestId);
        const decided = decideRequest(request, input.approve, actor.userId, input.decision, now);
        await scope.requests.update(decided);
        if (input.approve) {
          await scope.grants.upsert(grantOperation(request.serviceId, request.operationKey, actor.userId, now));
          await scope.events.publish(DomainTopic.grantChanged, { occurredAt: now.toISOString(), serviceId: request.serviceId, operationKey: request.operationKey, state: 'granted' });
        }
        return requestToDto(decided);
      });
    },
    revokeGrant: async (actor: Actor, serviceId: ServiceId, operationKey: string): Promise<void> => {
      if (!actor.isAdmin) throw forbidden('只有管理员可以撤销授权');
      const now = clock.now();
      await uow.run(async (scope) => {
        const existing = await scope.grants.get(serviceId, operationKey);
        if (!existing || existing.state !== 'granted') throw notFound('授权', operationKey);
        await scope.grants.upsert(revokeGrant(existing, now));
        await scope.events.publish(DomainTopic.grantChanged, { occurredAt: now.toISOString(), serviceId, operationKey, state: 'revoked' });
      });
    },
  };
}
