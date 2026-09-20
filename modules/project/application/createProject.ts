import type { Actor, CreateProjectRequest, ProjectDto, ProjectId, ServiceId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { conflict, newId, validation } from '@crewstation/kernel';
import type { Project } from '../domain/project';
import { RESERVED_SLUGS, namespaceFor } from '../domain/project';
import type { Service } from '../domain/service';
import { serviceIdentity } from '../domain/service';
import type { ProjectUseCaseDeps } from './dependencies';
import { validateCreation } from './creation/eligibility';
import { projectToDto } from './toDto';

/** 管理员代建项目并指定负责人（G16）：项目、服务、负责人成员、配额在一个事务内落库并发布 project.created。 */
export function createProjectUseCase(deps: ProjectUseCaseDeps) {
  const { uow, roleLock, settings, clock } = deps;
  return async (actor: Actor, input: CreateProjectRequest): Promise<ProjectDto> => {
    return roleLock.run(input.ownerUserId ?? actor.userId, async () => {
    const ownerUserId = await validateCreation(deps, actor, input);
    if (RESERVED_SLUGS.includes(input.slug)) throw validation(`slug ${input.slug} 是保留名`, { field: 'slug', reserved: RESERVED_SLUGS });
    const now = clock.now();
    return uow.run(async (scope) => {
      if (await scope.projects.getBySlug(input.slug)) throw conflict(`项目 ${input.slug} 已存在`, { field: 'slug', slug: input.slug });
      const planName = input.plan ?? settings.defaultServicePlan;
      if (!(await scope.catalog.getServicePlan(planName))) throw validation(`服务套餐 ${planName} 不存在`, { field: 'plan' });
      const project: Project = {
        id: newId('prj') as ProjectId, slug: input.slug, name: input.name, kind: input.kind, namespace: namespaceFor(input.slug),
        ownerUserId, state: 'provisioning', template: input.template, initialPlan: planName, createdBy: actor.userId, createdAt: now, updatedAt: now,
      };
      const service: Service = { id: newId('svc') as ServiceId, projectId: project.id, name: input.slug, kind: input.kind, identity: serviceIdentity(input.slug, input.slug), createdAt: now };
      await scope.projects.insert(project);
      await scope.services.insert(service);
      await scope.memberships.upsert({ projectId: project.id, userId: ownerUserId, role: 'owner' });
      await scope.quotas.upsert({ projectId: project.id, maxConcurrentTasks: input.maxConcurrentTasks ?? settings.defaultMaxConcurrentTasks });
      await scope.events.publish(DomainTopic.projectCreated, { occurredAt: now.toISOString(), projectId: project.id, slug: project.slug, kind: project.kind, namespace: project.namespace });
      return projectToDto(project, service);
    });
    });
  };
}
