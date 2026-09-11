import type { Actor, ProjectDto, ProjectId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { forbidden, notFound } from '@crewstation/kernel';
import { transition } from '../domain/project';
import type { ProjectUseCaseDeps } from './dependencies';
import { projectToDto } from './toDto';

/** 归档是独立授权的管理员动作（R37）：不删源码仓库与业务数据，只停止调度并冻结访问。 */
export function archiveProjectUseCase({ uow, clock }: ProjectUseCaseDeps) {
  return async (actor: Actor, projectId: ProjectId): Promise<ProjectDto> => {
    if (!actor.isAdmin) throw forbidden('只有管理员可以归档项目');
    const now = clock.now();
    return uow.run(async (scope) => {
      const project = await scope.projects.getById(projectId);
      if (!project) throw notFound('项目', projectId);
      const archived = transition(project, 'archived', now);
      await scope.projects.update(archived);
      await scope.events.publish(DomainTopic.projectArchived, { occurredAt: now.toISOString(), projectId });
      return projectToDto(archived, await scope.services.getByProject(projectId));
    });
  };
}
