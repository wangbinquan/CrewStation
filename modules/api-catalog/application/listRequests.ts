import type { Actor, ApiRequestDto, ProjectId } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import type { ApiCatalogUseCaseDeps } from './dependencies';
import { requestToDto } from './toDto';

export function listRequestsUseCase({ uow, projects }: ApiCatalogUseCaseDeps) {
  return async (actor: Actor, projectId?: ProjectId): Promise<ApiRequestDto[]> => {
    if (projectId === undefined) {
      if (!actor.isAdmin) throw forbidden('只有管理员可以查看全部申请');
    } else {
      await projects.authorize(actor, projectId, 'view');
    }
    return (await uow.read.requests.list(projectId)).map(requestToDto);
  };
}
