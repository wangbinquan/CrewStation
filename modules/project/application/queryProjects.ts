import type { Actor, ListProjectsQuery, ProjectDto, ProjectId, ProjectState, ServiceDto, ServiceId, UserId } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import { transition } from '../domain/project';
import { developerActor } from './creation/eligibility';
import { authorizationUseCases } from './authorization';
import type { ProjectUseCaseDeps } from './dependencies';
import { projectToDto, serviceToDto } from './toDto';
import type { Service } from '../domain/service';
import type { Project } from '../domain/project';

const resolved = (service: Service, project: Project | undefined) =>
  project
    ? { projectId: project.id, serviceId: service.id, slug: project.slug, name: service.name, identity: service.identity, namespace: project.namespace, kind: service.kind, state: project.state }
    : undefined;

export function queryProjectUseCases(deps: ProjectUseCaseDeps) {
  const { uow, hosts, clock } = deps;
  const { authorize } = authorizationUseCases(deps);
  const load = async (projectId: ProjectId) => {
    const project = await uow.read.projects.getById(projectId);
    if (!project) throw notFound('项目', projectId);
    return { project, service: await uow.read.services.getByProject(projectId) };
  };
  return {
    getProject: async (actor: Actor, projectId: ProjectId): Promise<ProjectDto> => {
      await authorize(actor, projectId, 'view');
      const { project, service } = await load(projectId);
      return projectToDto(project, service);
    },
    listUserMemberships: async (userId: UserId) => (await uow.read.memberships.listByUser(userId)).map(({ projectId, role }) => ({ projectId, role })),
    /**
     * 先按作用域取（管理员看全部、成员看自己的），再按 kind 过滤（RFC-002）。
     * 顺序不能反：kind 是视图筛选，不是放大可见范围的口子——普通成员带 `kind=APIProxy`
     * 也只会在他自己的项目里筛，拿不到别人的接入容器。
     */
    listProjects: async (actor: Actor, query?: ListProjectsQuery): Promise<ProjectDto[]> => {
      actor = await developerActor(deps, actor);
      const memberships = await uow.read.memberships.listByUser(actor.userId);
      const projects = actor.isAdmin ? await uow.read.projects.list() : (await uow.read.projects.listByIds(memberships.filter((m) => m.role !== 'tester').map((m) => m.projectId))).filter((p) => p.kind === 'DigitalWorker');
      const kinds = query?.kind;
      const dtos = await Promise.all(projects.map(async (p) => projectToDto(p, await uow.read.services.getByProject(p.id))));
      return kinds === undefined ? dtos : dtos.filter((dto) => kinds.includes(dto.kind));
    },
    getService: async (actor: Actor, serviceId: ServiceId): Promise<ServiceDto> => {
      const service = await uow.read.services.getById(serviceId);
      if (!service) throw notFound('服务', serviceId);
      await authorize(actor, service.projectId, 'view');
      const { project } = await load(service.projectId);
      return serviceToDto(service, project, hosts);
    },
    /** 供网关与其他模块把 `<project>/<service>` 解析成对象；无 actor，调用方自行保证只在受信路径使用。 */
    resolveServiceIdentity: async (identity: string) => {
      const service = await uow.read.services.getByIdentity(identity);
      return service ? resolved(service, await uow.read.projects.getById(service.projectId)) : undefined;
    },
    resolveServiceById: async (serviceId: ServiceId) => {
      const service = await uow.read.services.getById(serviceId);
      return service ? resolved(service, await uow.read.projects.getById(service.projectId)) : undefined;
    },
    resolveServiceOfProject: async (projectId: ProjectId) => {
      const [service, project] = await Promise.all([uow.read.services.getByProject(projectId), uow.read.projects.getById(projectId)]);
      return service ? resolved(service, project) : undefined;
    },
    listClusterProjects: () => clusterProjectDirectory(deps),
    listServices: async () => {
      const out = [];
      for (const project of await uow.read.projects.list()) {
        if (project.state === 'archived') continue;
        const service = await uow.read.services.getByProject(project.id);
        const item = service ? resolved(service, project) : undefined;
        if (item) out.push(item);
      }
      return out;
    },
    getProvisioningProject: async (projectId: ProjectId) => {
      const project = await uow.read.projects.getById(projectId);
      if (!project || project.state === 'archived') return undefined;
      const service = await uow.read.services.getByProject(projectId);
      if (!service) return undefined;
      return { projectId, serviceId: service.id, slug: project.slug, name: project.name, namespace: project.namespace, kind: project.kind,
        state: project.state, template: project.template, ...(project.initialPlan === undefined ? {} : { initialPlan: project.initialPlan }) };
    },
    ownerOf: async (projectId: ProjectId) => (await uow.read.projects.getById(projectId))?.ownerUserId,
    /** 控制面在命名空间与首个发布就绪后推进状态；不经 actor。 */
    setProjectState: async (projectId: ProjectId, state: ProjectState, message?: string): Promise<ProjectDto> => uow.run(async (scope) => {
      const project = await scope.projects.getById(projectId);
      if (!project) throw notFound('项目', projectId);
      const next = transition(project, state, clock.now(), message);
      await scope.projects.update(next);
      return projectToDto(next, await scope.services.getByProject(projectId));
    }),
  };
}

async function clusterProjectDirectory({ uow }: ProjectUseCaseDeps) {
      const result = []; let after: string | undefined;
      for (let page = 0; page < 1000; page++) {
        const projects = await uow.read.projects.list({ after, limit: 500 });
        const byProject = new Map((await uow.read.services.list(projects.map((p) => p.id))).map((s) => [s.projectId, s]));
        result.push(...projects.map((p) => { const s = byProject.get(p.id); return { projectId: p.id, name: p.name, slug: p.slug, namespace: p.namespace, kind: p.kind, state: p.state, ...(s ? { serviceId: s.id, serviceName: s.name } : {}) }; }));
        if (projects.length < 500) return result;
        after = projects.at(-1)!.id;
      }
      throw precondition('项目目录超过单轮采集上限，保留上次快照');
}
