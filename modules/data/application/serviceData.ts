import type { Actor, DataEnv, DataResourceDto, ProjectId, ServiceId } from '@crewstation/contracts';
import { newId, notFound } from '@crewstation/kernel';
import type { DataResource } from '../domain/dataResource';
import { ENV_VAR_BY_KIND, postgresObjectName, transition } from '../domain/dataResource';
import type { DataUseCaseDeps } from './dependencies';

/** 生产库与开发库随服务供给一次，之后跨发布保留；供给失败留下 failed 记录可重试，不自动删除已有数据。 */
export function serviceDataUseCases(deps: DataUseCaseDeps) {
  const { resources, postgres, cipher, services, clock, logger } = deps;

  const provision = async (serviceId: ServiceId, projectId: ProjectId, slug: string, env: DataEnv): Promise<DataResource> => {
    const existing = await resources.find(serviceId, env, 'postgres');
    if (existing && existing.state === 'ready') return existing;
    const now = clock.now();
    const objectName = postgresObjectName(slug, env);
    let resource: DataResource = existing
      ? transition(existing, 'provisioning', now)
      : { id: newId('dat'), projectId, serviceId, kind: 'postgres', env, plan: deps.settings.defaultPlan, state: 'requested', envVar: ENV_VAR_BY_KIND.postgres, objectName, createdAt: now, updatedAt: now };
    if (existing) await resources.update(resource); else await resources.insert(resource);
    if (!existing) { resource = transition(resource, 'provisioning', now); await resources.update(resource); }
    try {
      const { dsn } = await postgres.provisionDatabase({ databaseName: objectName, roleName: objectName });
      resource = transition(resource, 'ready', clock.now(), { secretBox: await cipher.encrypt(dsn) });
    } catch (error) {
      resource = transition(resource, 'failed', clock.now(), { message: error instanceof Error ? error.message : String(error) });
      logger.error('data provisioning failed', { serviceId, env, error: resource.message });
    }
    await resources.update(resource);
    return resource;
  };

  return {
    ensureServiceData: async (serviceId: ServiceId): Promise<DataResourceDto[]> => {
      const svc = await services.resolveServiceById(serviceId);
      if (!svc) throw notFound('服务', serviceId);
      const out: DataResource[] = [];
      for (const env of ['production', 'development'] as DataEnv[]) out.push(await provision(serviceId, svc.projectId, svc.slug, env));
      return out.map(toDto);
    },
    envFor: async (serviceId: ServiceId, env: DataEnv): Promise<Record<string, string>> => {
      const values: Record<string, string> = {};
      for (const resource of await resources.listByService(serviceId)) {
        if (resource.env === env && resource.state === 'ready' && resource.secretBox) values[resource.envVar] = await cipher.decrypt(resource.secretBox);
      }
      return values;
    },
    listResources: async (actor: Actor, projectId: ProjectId): Promise<DataResourceDto[]> => {
      await deps.authorizer.authorize(actor, projectId, 'view');
      return (await resources.listByProject(projectId)).map(toDto);
    },
    /** 供开发会话与业务任务的临时角色使用：生产库的对象名与运行角色。 */
    productionDatabase: async (serviceId: ServiceId): Promise<{ databaseName: string; roleName: string } | undefined> => {
      const prod = await resources.find(serviceId, 'production', 'postgres');
      return prod?.state === 'ready' ? { databaseName: prod.objectName, roleName: prod.objectName } : undefined;
    },
  };
}

export function toDto(r: DataResource): DataResourceDto {
  return { id: r.id, projectId: r.projectId, kind: r.kind, env: r.env, plan: r.plan, state: r.state, envVar: r.envVar, ...(r.message ? { message: r.message } : {}), createdAt: r.createdAt.toISOString() };
}
