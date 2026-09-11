// 装配：模块的 wiring 在这里被调用一次；进程知道拓扑，模块不知道。
import type { AppEnv } from '@crewstation/http';
import type { Logger } from '@crewstation/kernel';
import { createIdentityModule } from '@crewstation/module-identity';
import { createProjectModule } from '@crewstation/module-project';
import type { Database, MigrationSet } from '@crewstation/persistence';
import type { Hono } from 'hono';
import type { ApiSettings } from './settings';

export interface Assembly {
  routers: Hono<AppEnv>[];
  migrations: MigrationSet[];
}

export function assembleModules(db: Database, settings: ApiSettings, _logger: Logger): Assembly {
  const identity = createIdentityModule({ db, settings: { adminEmails: settings.adminEmails } });
  const project = createProjectModule({
    db,
    identity: identity.api,
    hosts: {
      prodHost: (slug) => `${slug}.${settings.userDomain}`,
      previewHost: (slug) => `preview.${slug}.${settings.userDomain}`,
      serviceHost: (name) => `${name}.${settings.serviceDomain}`,
    },
    settings: { defaultMaxConcurrentTasks: settings.defaultMaxConcurrentTasks, defaultServicePlan: settings.defaultServicePlan },
  });
  return {
    routers: [...project.http],
    migrations: [identity.migrations, project.migrations],
  };
}
