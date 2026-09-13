import { join } from 'node:path';
import { createGitLabClient } from '@crewstation/gitlab-client';
import type { AppEnv } from '@crewstation/http';
import type { Clock } from '@crewstation/kernel';
import { systemClock } from '@crewstation/kernel';
import type { ProjectModuleApi } from '@crewstation/module-project';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { directoryTemplateSource } from './adapters/fs/directoryTemplateSource';
import { osScratchDirs } from './adapters/fs/osScratchDirs';
import { bunGitRunner } from './adapters/git/bunGitRunner';
import { gitLabGatewayAdapter } from './adapters/gitlab/gitLabGatewayAdapter';
import { drizzleUnitOfWork } from './adapters/persistence/drizzleUnitOfWork';
import type { ActorResolver, ScmModuleApi } from './api/moduleApi';
import { createReleaseTagUseCase } from './application/createReleaseTag';
import type { ScmUseCaseDeps } from './application/dependencies';
import { ensureRepositoryUseCase } from './application/ensureRepository';
import { pushBranchUseCase } from './application/pushBranch';
import { queryRepositoryUseCases } from './application/queryRepository';
import { listTemplatesUseCase } from './application/listTemplates';
import { sessionCredentialUseCases } from './application/sessionCredentials';
import { repositoryRoutes } from './http/repositoryRoutes';
import type { ScmSettings } from './ports/scmSettings';

const DEFAULT_BOT_EMAIL = 'bot@crewstation.local';

export interface ScmModuleDeps {
  db: Database;
  project: Pick<ProjectModuleApi, 'authorize' | 'isAdmin'>;
  settings: ScmSettings;
  /** 业务项目模板所在目录；默认仓库根 `templates/`。 */
  templatesRoot?: string;
  /** 开发源码中的 integrations/；自定义 templatesRoot 时不隐式混入仓内模板。 */
  integrationTemplatesRoot?: string;
  clock?: Clock;
  fetch?: typeof fetch;
  /** 只供测试与本机调试替换外部系统适配器（GitLab、git、模板、临时目录）。 */
  overrides?: Partial<Pick<ScmUseCaseDeps, 'gitlab' | 'git' | 'templates' | 'scratch'>>;
}

export interface ScmModule {
  readonly api: ScmModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly migrations: MigrationSet;
}

export const scmMigrations: MigrationSet = {
  module: 'scm',
  layer: 3,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createScmModule(deps: ScmModuleDeps): ScmModule {
  const { settings, overrides } = deps;
  const client = createGitLabClient({ baseUrl: settings.baseUrl, token: settings.platformToken, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  const useCaseDeps: ScmUseCaseDeps = {
    uow: drizzleUnitOfWork(deps.db),
    gitlab: overrides?.gitlab ?? gitLabGatewayAdapter(client),
    git: overrides?.git ?? bunGitRunner({ authorName: settings.platformBotName, authorEmail: settings.platformBotEmail ?? DEFAULT_BOT_EMAIL }),
    templates: overrides?.templates ?? directoryTemplateSource({ templatesRoot: deps.templatesRoot ?? join(import.meta.dir, '..', '..', 'templates'),
      ...(deps.integrationTemplatesRoot ? { integrationTemplatesRoot: deps.integrationTemplatesRoot } : deps.templatesRoot === undefined ? { integrationTemplatesRoot: join(import.meta.dir, '..', '..', 'integrations') } : {}) }),
    scratch: overrides?.scratch ?? osScratchDirs(),
    authorizer: { authorize: (actor, projectId, action) => deps.project.authorize(actor, projectId, action) },
    settings,
    clock: deps.clock ?? systemClock,
  };
  const api: ScmModuleApi = {
    name: 'scm',
    listTemplates: listTemplatesUseCase(useCaseDeps.templates),
    ensureRepository: ensureRepositoryUseCase(useCaseDeps),
    ...queryRepositoryUseCases(useCaseDeps),
    createReleaseTag: createReleaseTagUseCase(useCaseDeps),
    ...sessionCredentialUseCases(useCaseDeps),
    pushBranch: pushBranchUseCase(useCaseDeps),
  };
  const resolveActor: ActorResolver = async (userId) => ({ userId, isAdmin: await deps.project.isAdmin(userId) });
  return { api, http: [repositoryRoutes(api, resolveActor)], migrations: scmMigrations };
}
