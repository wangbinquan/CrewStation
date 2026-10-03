import { join } from 'node:path';
import { createGitLabClient } from '@crewstation/gitlab-client';
import type { AppEnv } from '@crewstation/http';
import type { Clock, Logger } from '@crewstation/kernel';
import { systemClock } from '@crewstation/kernel';
import type { ProjectModuleApi } from '@crewstation/module-project';
import type { Database, MigrationSet, ResourceIdentityDirectory } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { directoryTemplateSource } from './adapters/fs/directoryTemplateSource';
import { osScratchDirs } from './adapters/fs/osScratchDirs';
import { bunGitRunner } from './adapters/git/bunGitRunner';
import { gitLabGatewayAdapter } from './adapters/gitlab/gitLabGatewayAdapter';
import { drizzleUnitOfWork } from './adapters/persistence/drizzleUnitOfWork';
import { legacyManifestUpgrade } from './adapters/persistence/legacyManifestUpgrade';
import { scmDeletionRepository, scmRepositoryWrites } from './adapters/persistence/repositoryAdmission';
import type { ActorResolver, ScmModuleApi } from './api/moduleApi';
import { createReleaseTagUseCase, pushBranchUseCase } from './application/repositoryMutations';
import type { ScmUseCaseDeps } from './ports/useCaseDependencies';
import { ensureRepositoryUseCase } from './application/ensureRepository';
import { queryRepositoryUseCases } from './application/queryRepository';
import { listTemplatesUseCase } from './application/listTemplates';
import { previewManifestUpgradeUseCase } from './application/previewManifestUpgrade';
import { sessionCredentialUseCases } from './application/sessionCredentials';
import { scmCallbackObserver } from './application/projectAdmission';
import { scmProjectDeletionOwner } from './application/projectDeletion';
import { repositoryRoutes } from './http/repositoryRoutes';
import type { TemplateResourceBindings } from './ports/templateSource';
import type { ScmSettings } from './ports/scmSettings';
import type { ScmCallbackProcesses } from './ports/repositoryWrites';
import type { ScmDeletionPhysics } from './ports/projectDeletion';
import type { ScmCurrentRepositoryOriginsSource } from './ports/currentRepositoryOrigins';

const DEFAULT_BOT_EMAIL = 'bot@crewstation.local';

export interface ScmModuleDeps {
  identities?: ResourceIdentityDirectory;
  templateResources?: TemplateResourceBindings;
  db: Database;
  project: Pick<ProjectModuleApi, 'authorize' | 'isAdmin'> & Partial<Pick<ProjectModuleApi, 'assertProjectAvailable' | 'assertProjectDeletionGrant'>>;
  processes?: ScmCallbackProcesses;
  /** Original native/storage source; absent or incomplete sources keep permanent deletion unavailable. */
  deletionPhysics?: ScmDeletionPhysics;
  currentRepositoryOrigins?: ScmCurrentRepositoryOriginsSource;
  settings: ScmSettings;
  /** 业务项目模板所在目录；默认仓库根 `templates/`。 */
  templatesRoot?: string;
  /** 开发源码中的 integrations/；自定义 templatesRoot 时不隐式混入仓内模板。 */
  integrationTemplatesRoot?: string;
  clock?: Clock;
  logger?: Pick<Logger, 'warn'>;
  fetch?: typeof fetch;
  /** 只供测试与本机调试替换外部系统适配器（GitLab、git、模板、临时目录）。 */
  overrides?: Partial<Pick<ScmUseCaseDeps, 'gitlab' | 'git' | 'templates' | 'scratch'>>;
}

export interface ScmModule {
  readonly api: ScmModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly migrations: MigrationSet;
  readonly observer: { start(): void; stop(): Promise<void> };
}

export const scmMigrations: MigrationSet = {
  module: 'scm',
  layer: 3,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createScmModule(deps: ScmModuleDeps): ScmModule {
  const { settings, overrides } = deps;
  const client = createGitLabClient({ baseUrl: settings.baseUrl, token: settings.platformToken, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  const writes = scmRepositoryWrites({ db: deps.db, ...(deps.processes ? { processes: deps.processes } : {}),
    ...(deps.project.assertProjectAvailable ? { assertAvailable: deps.project.assertProjectAvailable } : {}),
    ...(deps.project.assertProjectDeletionGrant ? { assertGrant: deps.project.assertProjectDeletionGrant } : {}) });
  const useCaseDeps: ScmUseCaseDeps = {
    ...(deps.identities ? { manifestUpgrade: legacyManifestUpgrade(deps.identities, deps.templateResources) } : {}),
    uow: drizzleUnitOfWork(deps.db, writes),
    gitlab: overrides?.gitlab ?? gitLabGatewayAdapter(client),
    git: overrides?.git ?? bunGitRunner({ authorName: settings.platformBotName, authorEmail: settings.platformBotEmail ?? DEFAULT_BOT_EMAIL }),
    templates: overrides?.templates ?? directoryTemplateSource({ resources: deps.templateResources, templatesRoot: deps.templatesRoot ?? join(import.meta.dir, '..', '..', 'templates'),
      ...(deps.integrationTemplatesRoot ? { integrationTemplatesRoot: deps.integrationTemplatesRoot } : deps.templatesRoot === undefined ? { integrationTemplatesRoot: join(import.meta.dir, '..', '..', 'integrations') } : {}) }),
    scratch: overrides?.scratch ?? osScratchDirs(),
    authorizer: { authorize: (actor, projectId, action) => deps.project.authorize(actor, projectId, action) },
    settings,
    clock: deps.clock ?? systemClock,
  };
  const api: ScmModuleApi = {
    name: 'scm',
    ...(deps.deletionPhysics && deps.project.assertProjectDeletionGrant ? { deletionOwner: scmProjectDeletionOwner({ writes,
      repository: scmDeletionRepository({ db: deps.db, assertGrant: deps.project.assertProjectDeletionGrant }), physics: deps.deletionPhysics, currentOrigins: deps.currentRepositoryOrigins, assertGrant: deps.project.assertProjectDeletionGrant }) } : {}),
    repositoryWrites: { history: writes.history, close: writes.close, recover: writes.recover },
    listTemplates: listTemplatesUseCase(useCaseDeps.templates),
    previewManifestUpgrade: previewManifestUpgradeUseCase(useCaseDeps),
    ensureRepository: ensureRepositoryUseCase(useCaseDeps),
    ...queryRepositoryUseCases(useCaseDeps),
    createReleaseTag: createReleaseTagUseCase(useCaseDeps),
    ...sessionCredentialUseCases(useCaseDeps),
    pushBranch: pushBranchUseCase(useCaseDeps),
  };
  const resolveActor: ActorResolver = async (userId) => ({ userId, isAdmin: await deps.project.isAdmin(userId) });
  return { api, http: [repositoryRoutes(api, resolveActor)], migrations: scmMigrations, observer: scmCallbackObserver(writes.observe, (message) => deps.logger?.warn(message)) };
}
