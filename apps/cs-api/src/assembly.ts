// 装配：模块的 wiring 在这里被调用一次；进程知道拓扑，模块不知道。
import type { ProjectId, ServiceId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { K8sClient } from '@crewstation/k8s';
import type { Logger } from '@crewstation/kernel';
import { createConfigModule } from '@crewstation/module-config';
import { createDataModule } from '@crewstation/module-data';
import { createEgressModule } from '@crewstation/module-egress';
import { createGatewayModule } from '@crewstation/module-gateway';
import { createIdentityModule } from '@crewstation/module-identity';
import { createProjectModule } from '@crewstation/module-project';
import type { Database, MigrationSet } from '@crewstation/persistence';
import type { Hono } from 'hono';
import type { ApiSettings } from './settings';

export interface Assembly {
  routers: Hono<AppEnv>[];
  migrations: MigrationSet[];
}

/** cs-api 只挂各模块的 http 入口；工作器与订阅在 cs-controller、cs-events 里启动。 */
export function assembleModules(db: Database, k8s: K8sClient, settings: ApiSettings, logger: Logger): Assembly {
  const hosts = {
    prodHost: (slug: string) => `${slug}.${settings.userDomain}`,
    previewHost: (slug: string) => `preview.${slug}.${settings.userDomain}`,
    serviceHost: (name: string) => `${name}.${settings.serviceDomain}`,
    platformApiHost: () => `api.${settings.serviceDomain}`,
  };
  const identity = createIdentityModule({ db, settings: { adminEmails: settings.adminEmails, userDomain: settings.userDomain, cookieDomain: `.${settings.userDomain}`, secure: false, sessionTtlSeconds: 28800 } });
  const project = createProjectModule({ db, identity: identity.api, hosts, settings: { defaultMaxConcurrentTasks: settings.defaultMaxConcurrentTasks, defaultServicePlan: settings.defaultServicePlan } });
  const isAdmin = (userId: string) => identity.api.isAdmin(userId as never);
  const config = createConfigModule({ db, project: project.api, settings: { secretKeyBase64: settings.secretKeyBase64 } });
  const egress = createEgressModule({ db, project: project.api });
  const data = createDataModule({
    db, isAdmin: (id) => isAdmin(id),
    authorizer: { authorize: (actor, projectId, action) => project.api.authorize(actor, projectId, action) },
    services: { resolveServiceById: async (serviceId) => { const svc = await resolveService(project.api, serviceId); return svc ? { projectId: svc.projectId, slug: svc.slug } : undefined; } },
    settings: { defaultPlan: 'db-small', secretKeyBase64: settings.secretKeyBase64, postgres: settings.dataPostgres },
  });
  const gateway = createGatewayModule({
    db, k8s, isAdmin: (id) => isAdmin(id), hosts,
    services: {
      listServices: async () => listAllServices(project.api),
      getService: async (serviceId) => (await listAllServices(project.api)).find((s) => s.serviceId === serviceId),
      serviceIdOfProject: async (projectId: ProjectId) => (await listAllServices(project.api)).find((s) => s.projectId === projectId)?.serviceId,
    },
    slots: { slotRoles: async () => undefined },
    grants: { grantedOperations: async () => ({ operations: [], defaultOpen: [] }), listCallers: async () => [], proxyNameOf: async () => undefined },
    settings: { systemNamespace: settings.systemNamespace, serviceDomain: settings.serviceDomain, userAuthMiddleware: 'forward-auth-user', serviceAuthMiddleware: 'forward-auth-service', dropIdentityHeadersMiddleware: 'drop-identity-headers', allowlistMaxStaleSeconds: 300, consumerName: 'cs-api.gateway' },
    logger,
  });
  return {
    routers: [...project.http, ...identity.http.users, ...config.http, ...egress.http, ...data.http, ...gateway.http],
    migrations: [identity.migrations, project.migrations, config.migrations, egress.migrations, data.migrations, gateway.migrations],
  };
}

type ProjectApi = ReturnType<typeof createProjectModule>['api'];

async function resolveService(api: ProjectApi, serviceId: ServiceId) {
  const admin = { userId: 'usr_00000000000000000000000000000000' as never, isAdmin: true };
  try {
    const svc = await api.getService(admin, serviceId);
    const resolved = await api.resolveServiceIdentity(svc.identity);
    return resolved ? { ...resolved, name: svc.name } : undefined;
  } catch {
    return undefined;
  }
}

async function listAllServices(api: ProjectApi) {
  const admin = { userId: 'usr_00000000000000000000000000000000' as never, isAdmin: true };
  const out = [];
  for (const p of await api.listProjects(admin)) {
    if (!p.serviceId) continue;
    const svc = await api.getService(admin, p.serviceId);
    out.push({ serviceId: p.serviceId, projectId: p.id, projectSlug: p.slug, serviceName: svc.name, namespace: p.namespace, identity: svc.identity, kind: p.kind });
  }
  return out;
}
