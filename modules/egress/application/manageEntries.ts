import type { Actor, AddEgressEntryRequest, EgressEntryDto, ProjectId } from '@crewstation/contracts';
import { conflict, forbidden, newId, notFound, validation } from '@crewstation/kernel';
import { newEgressEntry } from '../domain/egressEntry';
import type { EgressUseCaseDeps } from './dependencies';
import { entryToDto } from './toDto';

/** 白名单条目由管理员维护（G23）；项目成员只能看到全局条目与本项目条目。 */
export function entryUseCases({ uow, authorizer, clock }: EgressUseCaseDeps) {
  const adminOnly = (actor: Actor): void => {
    if (!actor.isAdmin) throw forbidden('只有管理员可以维护出站白名单');
  };
  return {
    addEntry: async (actor: Actor, input: AddEgressEntryRequest): Promise<EgressEntryDto> => {
      adminOnly(actor);
      const entry = newEgressEntry({ id: newId('egr'), ...input, createdBy: actor.userId, createdAt: clock.now() });
      return uow.run(async (scope) => {
        const existing = await scope.entries.find(entry.fqdn, entry.scope, entry.projectId);
        if (existing) throw conflict(`条目 ${entry.fqdn} 已存在`, { id: existing.id });
        await scope.entries.insert(entry);
        return entryToDto(entry);
      });
    },
    removeEntry: async (actor: Actor, id: string): Promise<void> => {
      adminOnly(actor);
      await uow.run(async (scope) => {
        if (!(await scope.entries.getById(id))) throw notFound('出站白名单条目', id);
        await scope.entries.remove(id);
      });
    },
    listEntries: async (actor: Actor, projectId?: ProjectId): Promise<EgressEntryDto[]> => {
      if (projectId === undefined) {
        if (!actor.isAdmin) throw validation('非管理员必须指定 projectId');
        return (await uow.read.entries.listAll()).map(entryToDto);
      }
      await authorizer.authorize(actor, projectId, 'view');
      return (await uow.read.entries.listEffective(projectId)).map(entryToDto);
    },
  };
}
