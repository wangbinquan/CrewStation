import { createRuntimeImageSetup } from './application/catalog/createSetup';
export { runtimeImageRegistryDeletionPhysics as createRuntimeImageRegistryDeletionPhysics } from './adapters/registry/deletionPhysics';
export { nativeRuntimeImageWorkPhysics as createNativeRuntimeImageWorkPhysics } from './adapters/native/projectWork';
import { projectImagePolicy } from './application/projectImagePolicy';
import { imageResourceAllocationUseCases } from './application/resourceAllocation';
import { projectImagePolicyRoutes } from './http/projectImagePolicyRoutes';
import { adminRuntimeImageCatalogRoutes } from './http/adminCatalogRoutes';
import { adminRuntimeImageVersionRoutes } from './http/adminVersionRoutes';
import { runtimeImageExecutionHistory } from './application/catalog/executionHistory';
import type { RuntimeImageExecutionHistory } from './ports/executionHistory';
import { join } from 'node:path';
import type { Actor, ProjectDeletionContext, UserId } from '@crewstation/contracts';
import type { Clock, Logger } from '@crewstation/kernel';
import { jsonHash, newResourceId, noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { AppEnv } from '@crewstation/http';
import type { Hono } from 'hono';
import type { RuntimeEnvironmentModuleApi } from './api/moduleApi';
import type { RuntimeInitializationSecrets, RuntimeImageAuthorizer, RuntimeImageLimits, RuntimeImageSourceResolver, RuntimeImageValidationContracts } from './ports/platform';
import { runtimeImageProjectAdmissions, runtimeImageUnitOfWork } from './adapters/persistence/unitOfWork';
import { developmentImagePolicy } from './application/developmentPolicy';
import { developmentImageRoutes } from './http/developmentRoutes';
import { runtimeImageCatalog } from './application/catalog';
import { runtimeImageBuilds } from './application/builds';
import { runtimeImageRoutes } from './http/imageRoutes';
import { runtimeImageValidations } from './application/validations';
import { runtimeImageReferences } from './application/references';
import { runtimeImageVersionLifecycle } from './application/versionLifecycle';
import { runtimeImageVersionRoutes } from './http/versionRoutes';
import type { RuntimeImageBuildExecutor } from './ports/buildExecutor';
import type { RuntimeImageValidationExecutor } from './ports/validationExecutor';
import { validationExecutorWithServices } from './application/validation/service';
import { runtimeImageValidationController } from './application/validation/controller';
import { runtimeImageBuildController } from './application/buildController';
import type { K8sClient } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';
import { periodicJob, type LeasePort } from '@crewstation/resource-runtime';
import type { ImageBuild, ImageRevision } from './domain/records';
import { runtimeImageBuildPlan, type RuntimeImageBuilderSettings } from './domain/buildPlan';
import type { RuntimeRegistryLayout, RegistryRepositoryAccess } from './domain/registryReference';
import type { ImageBuildBase, ImageSourceRepository } from './ports/sourceRepository';
import type { RuntimeBuildLedger } from './ports/buildLedger';
import type { RuntimeBuildCredentials } from './ports/buildCredentials';
import { databaseBuildIntents } from './adapters/persistence/buildIntents';
import { kubernetesRuntimeImageBuildExecutor } from './adapters/k8s/buildExecutor';
import { httpRuntimeImageRegistry } from './adapters/registry/runtimeImageRegistry';
import { runtimeImageBuildSecretValues, runtimeImageBuildCreationWork } from './application/buildSecretValues';
import { configuredImageResolver, serviceImageResolver } from './adapters/registry/serviceImage';
import { runtimeImageSourcePreparation } from './application/sourcePreparation';
import { runtimeImageReferenceReconciliation } from './application/referenceReconciliation';
import type { RuntimeImageReferenceOwners } from './ports/referenceOwners';
import type { RuntimeImageCallbackProcess } from './ports/unitOfWork';
import type { RuntimeImageDeletionPhysics } from './ports/projectDeletion';
import { runtimeImageDeletionRepository } from './adapters/persistence/projectDeletion';
import { runtimeImageProjectDeletionOwner } from './application/projectDeletion';

export const runtimeEnvironmentMigrations: MigrationSet = { module: 'runtime-environment', layer: 4, files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')) };

export interface RuntimeEnvironmentModuleDeps {
  /** Callback admission requires the original process source and project availability port. */
  readonly projectAdmission?: { protectCurrent(): Promise<RuntimeImageCallbackProcess>; assertAvailable(projectId: string): Promise<void>; assertNativeRegistryAvailable?: () => Promise<void> };
  readonly deletion?: { physics: RuntimeImageDeletionPhysics; assertGrant(context: ProjectDeletionContext): Promise<void> };
  readonly executionHistory?: RuntimeImageExecutionHistory;
  readonly referenceOwners?: RuntimeImageReferenceOwners;
  readonly db: Database;
  readonly authorizer: RuntimeImageAuthorizer;
  readonly sources: RuntimeImageSourceResolver;
  readonly validationContracts: RuntimeImageValidationContracts;
  readonly initializationSecrets?: RuntimeInitializationSecrets;
  readonly buildExecutor: RuntimeImageBuildExecutor;
  readonly validationExecutor?: RuntimeImageValidationExecutor;
  readonly limits: RuntimeImageLimits;
  readonly clock?: Clock;
  readonly logger?: Logger;
  isAdmin(id: UserId): Promise<boolean>;
}

export interface RuntimeEnvironmentModule {
  readonly api: RuntimeEnvironmentModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly migrations: MigrationSet;
}

export function createRuntimeEnvironmentModule(deps: RuntimeEnvironmentModuleDeps): RuntimeEnvironmentModule {
  if (deps.deletion && !deps.projectAdmission) throw precondition('运行镜像永久清理必须同时装配原回调准入来源');
  const projectAdmissions = deps.projectAdmission ? runtimeImageProjectAdmissions({ ...deps.projectAdmission, db: deps.db }) : undefined;
  const sources: RuntimeImageSourceResolver = { prepare: async (actor, projectId, source) => {
    const prepare = () => deps.sources.prepare(actor, projectId, source);
    return projectAdmissions ? projectAdmissions.run(projectId ? [projectId] : [], { kind: 'source', id: newResourceId(), inputDigest: jsonHash({ projectId, source }) }, prepare) : prepare();
  } };
  const initializationSecrets: RuntimeInitializationSecrets | undefined = deps.initializationSecrets && { render: async (projectId, stamps) => {
    const render = () => deps.initializationSecrets!.render(projectId, stamps);
    return projectAdmissions ? projectAdmissions.run([projectId], { kind: 'initializer', id: newResourceId(), inputDigest: jsonHash({ projectId, stamps }) }, render) : render();
  } };
  const useCases = { ...deps, sources, initializationSecrets, projectAdmissions, uow: runtimeImageUnitOfWork(deps.db, deps.projectAdmission?.assertNativeRegistryAvailable), clock: deps.clock ?? systemClock, logger: deps.logger ?? noopLogger };
  const api: RuntimeEnvironmentModuleApi = { name: 'runtime-environment',
    ...(deps.deletion ? { deletionOwner: runtimeImageProjectDeletionOwner({ ...deps.deletion, repository: runtimeImageDeletionRepository({ db: deps.db, assertGrant: deps.deletion.assertGrant }) }) } : {}),
    ...projectImagePolicy(useCases), ...imageResourceAllocationUseCases(useCases), createSetup: createRuntimeImageSetup(useCases), imageHistory: runtimeImageExecutionHistory(useCases), reconcileReferences: runtimeImageReferenceReconciliation(useCases), ...developmentImagePolicy(useCases), ...runtimeImageValidationController(useCases, deps.validationExecutor), ...runtimeImageCatalog(useCases), ...runtimeImageBuilds(useCases), ...runtimeImageValidations(useCases), ...runtimeImageReferences(useCases), ...runtimeImageVersionLifecycle(useCases), ...runtimeImageBuildController(useCases, deps.buildExecutor) };
  return { api, http: [adminRuntimeImageCatalogRoutes(api, deps.isAdmin), adminRuntimeImageVersionRoutes(api, deps.isAdmin), projectImagePolicyRoutes(api, deps.isAdmin), developmentImageRoutes(api, deps.isAdmin), runtimeImageRoutes(api, deps.isAdmin), runtimeImageVersionRoutes(api, deps.isAdmin)], migrations: runtimeEnvironmentMigrations };
}

export interface ManagedRuntimeEnvironmentDeps extends Omit<RuntimeEnvironmentModuleDeps, 'sources' | 'buildExecutor'> {
  readonly k8s: K8sClient; readonly ledger: RuntimeBuildLedger; readonly leases: LeasePort; readonly instance: string;
  readonly credentials: RuntimeBuildCredentials; readonly sourceRepository: ImageSourceRepository; readonly bases: ImageBuildBase;
  readonly registry: RuntimeRegistryLayout; readonly builder: RuntimeImageBuilderSettings;
  existingImageAccess(actor: Actor, projectId: string | undefined): Promise<RegistryRepositoryAccess>;
  buildContext(build: ImageBuild, revision: ImageRevision): Promise<{ namespace: string; slug: string; repositoryUrl: string }>;
  /** 由平台确认 builder 无法绕过仓库鉴权入口；失败时不能创建构建。 */
  assertBuildIsolation(): Promise<void>;
}

/** Kubernetes／资源台账装配；源码授权和凭据权限继续由各自所属模块提供。 */
export function createManagedRuntimeEnvironmentModule(deps: ManagedRuntimeEnvironmentDeps) {
  const clock = deps.clock ?? systemClock, logger = deps.logger ?? noopLogger;
  const registry = httpRuntimeImageRegistry(deps.registry), uow = runtimeImageUnitOfWork(deps.db, deps.projectAdmission?.assertNativeRegistryAvailable);
  const intents = databaseBuildIntents(deps.db, deps.ledger, clock);
  const executor = kubernetesRuntimeImageBuildExecutor({ ...deps, intents, registry, registryBase: deps.registry.pullBase, holder: deps.instance,
    plan: async (build, revision) => { await deps.assertBuildIsolation(); return runtimeImageBuildPlan(build, revision, await deps.buildContext(build, revision), deps.builder, clock.now()); },
  });
  const bases: ImageBuildBase = { resolve: async (actor, projectId, source) => {
    const reference = await deps.bases.resolve(actor, projectId, source); if (!reference) return undefined;
    if (!reference.startsWith(`${deps.registry.pullBase}/`)) throw precondition('平台底座不在受管仓库');
    const repository = reference.slice(deps.registry.pullBase.length + 1).split('@')[0]!.replace(/:[^/]*$/, '');
    const inspected = await registry.inspect(reference, source.architecture, { exact: [repository] });
    return `${inspected.repository}@${inspected.digest}`;
  } };
  const sources = runtimeImageSourcePreparation(deps.sourceRepository, bases, { resolve: async (actor, projectId, reference, architecture) => {
    const image = await registry.inspect(reference, architecture, await deps.existingImageAccess(actor, projectId));
    return `${image.repository}@${image.digest}`;
  } });
  const mod = createRuntimeEnvironmentModule({ ...deps, sources, buildExecutor: executor, validationExecutor: validationExecutorWithServices(registry, deps.registry.pullBase, deps.validationExecutor) });
  const admissions = deps.projectAdmission ? runtimeImageProjectAdmissions({ ...deps.projectAdmission, db: deps.db }) : undefined;
  const secretValues = runtimeImageBuildSecretValues(intents, deps.credentials, uow.read.revisions.get, admissions);
  return { ...mod, pinServiceImage: serviceImageResolver(deps.registry), pinPlatformImage: configuredImageResolver(deps.registry),
    withBuildCreationAdmission: runtimeImageBuildCreationWork(intents, uow.read.revisions.get, admissions),
    imageBuildSecretValues: async (input: Parameters<typeof secretValues>[0]) => { await deps.assertBuildIsolation(); return secretValues(input); },
    workers: [periodicJob(async () => { await mod.api.reconcileReferences(); }, () => logger.warn('runtime image reference worker failed'), 30000), periodicJob(mod.api.reconcileValidations, () => logger.warn('runtime image validation worker failed'), 2000), periodicJob(mod.api.reconcileBuilds, () => logger.warn('runtime image build worker failed'), 2000)],
  };
}
