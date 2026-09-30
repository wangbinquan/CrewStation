import type { Actor, ProjectId, ResourceTargetDescription, ServiceId, UserId } from '@crewstation/contracts';
import { conflict, forbidden, notFound, systemClock } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { ResourceAccessDeps } from '../application/dependencies';
import { resourceAccessRepository } from '../adapters/persistence/repository';
import type { ResourceAdapter } from '../ports/resources';
import { createResourceAccessModule } from '../wiring';

export function resourceFixture(db: Database) {
  const projectId = Bun.randomUUIDv7() as ProjectId, serviceId = Bun.randomUUIDv7() as ServiceId;
  const actors = { owner: { userId: Bun.randomUUIDv7() as UserId, isAdmin: false }, developer: { userId: Bun.randomUUIDv7() as UserId, isAdmin: false }, admin: { userId: Bun.randomUUIDv7() as UserId, isAdmin: true } };
  const roles = new Map<UserId, 'owner' | 'developer' | 'admin'>(Object.entries(actors).map(([role, actor]) => [actor.userId, role as 'owner' | 'developer' | 'admin']));
  const target = { resourceType: 'object-plan' as const, resourceId: Bun.randomUUIDv7(), action: 'grant' as const };
  let view: ResourceTargetDescription = { target, name: '独立资源目录项', revision: 'r1', current: {}, fields: [], impact: ['用于后续资源选择'], owned: false, available: true };
  let active = true, writes = 0, observed = true, crash = false;
  const receipts = new Map<string, { revision: string; effect: string; applied: boolean }>();
  const authorize = async (actor: Actor, id: ProjectId, action: string) => {
    if (id !== projectId || !roles.has(actor.userId)) throw notFound('项目');
    const role = roles.get(actor.userId)!;
    if (action === 'request-resources' && role === 'developer') throw forbidden('仅负责人申请');
    return role;
  };
  const adapter: ResourceAdapter = { resourceType: target.resourceType, list: async () => [view], read: async (_id, input) => { if (input.resourceId !== target.resourceId) throw notFound('目录'); return { ...view, target: input }; },
    apply: async (command) => {
      if (command.expectedRevision !== view.revision) throw conflict('领域修订已变化');
      writes++; view = { ...view, revision: 'r2', owned: true };
      const receipt = { revision: 'r2', effect: '等待实际供给', applied: false }; receipts.set(command.operationId, receipt);
      if (crash) throw new Error('响应在领域事务提交后丢失');
      return receipt;
    }, recover: async (_id, operationId) => receipts.get(operationId), observe: async () => ({ applied: observed, effect: observed ? '已验证实际供给' : '等待实际供给' }),
  };
  const project = { authorize, isAdmin: async (id: UserId) => roles.get(id) === 'admin', resolveServiceOfProject: async (id: ProjectId) => id === projectId ? { projectId, serviceId, slug: 'fixture', name: 'Fixture', identity: 'fixture', namespace: 'fixture', kind: 'DigitalWorker' as const, state: active ? 'active' as const : 'archived' as const } : undefined };
  const mod = createResourceAccessModule({ db, project, adapters: [adapter], userName: async () => '测试角色', instance: projectId });
  const deps: ResourceAccessDeps = { repository: resourceAccessRepository(db), adapters: [adapter], clock: systemClock, projects: { authorize, isAdmin: project.isAdmin, active: async () => active, requesterName: async () => '测试角色' } };
  return { mod, deps, actors, roles, projectId, target, input: () => ({ target, expectedRevision: view.revision, values: {}, reason: '项目开发需要此资源', requestKey: Bun.randomUUIDv7() }),
    open: () => mod.api.saveCatalogPolicy(actors.admin, projectId, target, { expectedRevision: 0, requestable: true }),
    changeView: (patch: Partial<ResourceTargetDescription>) => { view = { ...view, ...patch }; }, setActive: (value: boolean) => { active = value; }, setObserved: (value: boolean) => { observed = value; }, setCrash: () => { crash = true; }, writes: () => writes,
  };
}
