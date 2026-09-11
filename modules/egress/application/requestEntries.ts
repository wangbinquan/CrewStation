import type { Actor, DecideEgressRequest, EgressRequestDto, ProjectId, RequestEgressEntryRequest } from '@crewstation/contracts';
import { conflict, forbidden, newId, notFound, precondition, validation } from '@crewstation/kernel';
import { assertFqdnPattern, mergePolicy, newEgressEntry } from '../domain/egressEntry';
import type { EgressRequest } from '../domain/egressRequest';
import { decideRequest } from '../domain/egressRequest';
import { hostAllowed } from '../domain/fqdnMatch';
import type { EgressUseCaseDeps } from './dependencies';
import { requestToDto } from './toDto';

/** 开发者申请追加出站目标；管理员裁定，批准即生成项目级条目并在同一事务内生效。 */
export function requestUseCases({ uow, authorizer, clock }: EgressUseCaseDeps) {
  return {
    requestEntry: async (actor: Actor, projectId: ProjectId, input: RequestEgressEntryRequest): Promise<EgressRequestDto> => {
      await authorizer.authorize(actor, projectId, 'develop');
      const fqdn = assertFqdnPattern(input.fqdn);
      const now = clock.now();
      return uow.run(async (scope) => {
        const allow = mergePolicy(await scope.entries.listEffective(projectId));
        if (allow.includes(fqdn) || (!fqdn.startsWith('*.') && hostAllowed(allow, fqdn))) throw precondition(`${fqdn} 已在放行清单中`, { fqdn });
        const pending = await scope.requests.findPending(projectId, fqdn);
        if (pending) throw conflict(`${fqdn} 已有待裁定的申请`, { id: pending.id });
        const request: EgressRequest = { id: newId('egq'), projectId, fqdn, state: 'pending', requestedBy: actor.userId, createdAt: now, ...(input.reason ? { reason: input.reason } : {}) };
        await scope.requests.insert(request);
        return requestToDto(request);
      });
    },
    decideRequest: async (actor: Actor, id: string, input: DecideEgressRequest): Promise<EgressRequestDto> => {
      if (!actor.isAdmin) throw forbidden('只有管理员可以裁定出站申请');
      const now = clock.now();
      return uow.run(async (scope) => {
        const request = await scope.requests.getById(id);
        if (!request) throw notFound('出站申请', id);
        const decided = decideRequest(request, input.approve, actor.userId, input.decision, now);
        await scope.requests.update(decided);
        if (input.approve && !(await scope.entries.find(request.fqdn, 'project', request.projectId))) {
          const note = input.decision ?? `批准申请 ${request.id}`;
          await scope.entries.insert(newEgressEntry({ id: newId('egr'), fqdn: request.fqdn, scope: 'project', projectId: request.projectId, note, createdBy: actor.userId, createdAt: now }));
        }
        return requestToDto(decided);
      });
    },
    listRequests: async (actor: Actor, projectId?: ProjectId): Promise<EgressRequestDto[]> => {
      if (projectId === undefined) {
        if (!actor.isAdmin) throw validation('非管理员必须指定 projectId');
      } else {
        await authorizer.authorize(actor, projectId, 'view');
      }
      return (await uow.read.requests.list(projectId)).map(requestToDto);
    },
  };
}
