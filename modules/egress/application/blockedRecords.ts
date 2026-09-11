import type { Actor, BlockedEgressDto, EgressSource, ProjectId } from '@crewstation/contracts';
import { recordHit } from '../domain/blockedRecord';
import { normalizeHost } from '../domain/fqdnMatch';
import type { EgressUseCaseDeps } from './dependencies';
import { blockedToDto } from './toDto';

/** 出站代理上报被阻请求（内部，不经 actor）；项目成员在工作台查看。 */
export function blockedUseCases({ uow, authorizer, clock }: EgressUseCaseDeps) {
  return {
    recordBlocked: async (projectId: ProjectId, fqdn: string, source?: EgressSource): Promise<BlockedEgressDto> => {
      const now = clock.now();
      const host = normalizeHost(fqdn);
      return uow.run(async (scope) => {
        const record = recordHit(await scope.blocked.get(projectId, host), projectId, host, source, now);
        await scope.blocked.upsert(record);
        return blockedToDto(record);
      });
    },
    listBlocked: async (actor: Actor, projectId: ProjectId): Promise<BlockedEgressDto[]> => {
      await authorizer.authorize(actor, projectId, 'view');
      return (await uow.read.blocked.listByProject(projectId)).map(blockedToDto);
    },
  };
}
