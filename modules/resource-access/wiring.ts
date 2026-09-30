import { join } from 'node:path';
import type { UserId } from '@crewstation/contracts';
import { SaveResourceCatalogPolicySchema } from '@crewstation/contracts';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, precondition, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import { createWorker } from '@crewstation/queue';
import type { ProjectModuleApi } from '@crewstation/module-project';
import type { ResourceAccessModuleApi } from './api/moduleApi';
import { resourceAccessRepository, RESOURCE_CHANGE_JOB } from './adapters/persistence/repository';
import { createResourceRequest } from './application/createRequest';
import { resourceReviewUseCases } from './application/reviewRequest';
import { resourceInspectionUseCases } from './application/inspectTargets';
import { adapterOf, loadChange, requireAdmin } from './application/access';
import { applyResourceChange } from './application/applyChange';
import { changeDto } from './domain/change';
import { resourceAccessRoutes } from './http/resourceAccessRoutes';
import type { ResourceAdapter } from './ports/resources';
export type { ResourceAdapter } from './ports/resources';

export interface ResourceAccessModuleDeps {
  db: Database; project: Pick<ProjectModuleApi, 'authorize' | 'isAdmin' | 'resolveServiceOfProject'>;
  adapters: readonly ResourceAdapter[]; userName: (id: UserId) => Promise<string | null>;
  instance: string; clock?: Clock; logger?: Logger;
}
export const resourceAccessMigrations: MigrationSet = { module: 'resource-access', layer: 3, files: readMigrationDir(join(import.meta.dir, 'adapters/persistence/migrations')) };
export function createResourceAccessModule(input: ResourceAccessModuleDeps) {
  const repository = resourceAccessRepository(input.db);
  const deps = { repository, adapters: input.adapters, clock: input.clock ?? systemClock, projects: {
    authorize: input.project.authorize, isAdmin: input.project.isAdmin, requesterName: input.userName,
    active: async (id: Parameters<typeof input.project.resolveServiceOfProject>[0]) => { const service = await input.project.resolveServiceOfProject(id); return !!service && !['archived', 'deleting'].includes(service.state); },
  } };
  const api: ResourceAccessModuleApi = {
    name: 'resource-access', create: createResourceRequest(deps, false), direct: createResourceRequest(deps, true),
    ...resourceReviewUseCases(deps), ...resourceInspectionUseCases(deps),
    get: async (actor, projectId, id) => changeDto(await loadChange(deps, actor, projectId, id)),
    list: async (actor, projectId, query) => { await deps.projects.authorize(actor, projectId, 'view'); const page = await repository.list(projectId, query); return { ...page, items: page.items.map(changeDto) }; },
    saveCatalogPolicy: async (actor, projectId, target, raw) => {
      await requireAdmin(deps, actor); await deps.projects.authorize(actor, projectId, 'view');
      if (target.action !== 'grant') throw precondition('只有资源目录可设置申请资格');
      await adapterOf(deps, target).read(projectId, target);
      return repository.savePolicy(target.resourceType, target.resourceId, SaveResourceCatalogPolicySchema.parse(raw), actor.userId, deps.clock.now().toISOString());
    },
  };
  const worker = createWorker({ db: input.db, owner: `${input.instance}.resource-access`, kinds: [RESOURCE_CHANGE_JOB], concurrency: 2, leaseSeconds: 60, logger: input.logger ?? noopLogger,
    handler: async (job, ctx) => { const payload = job.payload as { changeId: string }; if (!await applyResourceChange(deps, payload.changeId, ctx.heartbeat)) throw new Error('等待资源实际生效，复用原变更回执继续观察'); },
  });
  return { api, http: [resourceAccessRoutes(api, input.project.isAdmin)], workers: [worker], migrations: resourceAccessMigrations, runOnce: () => worker.runOnce() };
}
export type ResourceAccessModule = ReturnType<typeof createResourceAccessModule>;
