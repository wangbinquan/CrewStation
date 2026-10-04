import { bindTaskMaintenance } from './adapters/observability/taskMaintenance'; import { clusterMetadata } from './application/cluster/metadata';
import { resourceCatalogs } from './application/resource-center/resourceCatalogs'; import { sessionDeletionSources } from './application/deletion/sessionSources';
import { businessRuntimePorts } from './application/deletion/businessSources';
import { developmentDeletionSources, developmentSourceControl } from './application/deletion/developmentSources';
import { runtimeDeletionSources } from './application/deletion/runtimeSources';
import { runtimeCleanupPorts } from './application/deletion/runtimeCleanup';
import { developmentDeletionSession } from './application/deletion/developmentSession';
import { runtimeCheckout } from './adapters/k8s/runtimeCheckout';
import { projectResourceState } from './adapters/k8s/projectResourceState';
import { projectResourceSources } from './application/resource-center/projectSources';
import { createResourceAccessModule } from '@crewstation/module-resource-access';
import { clusterOperationPorts } from './application/cluster/operations';
import { originalObservationTasks, originalObservationUsage } from './application/deletion/observationUsage';
import { developmentObservationSource } from './application/developmentObservationPorts';
import { completeRuntimeFactSources } from './application/completeRuntimeFactSources';
import { businessObservationAdmission, developmentObservationAdmission, observationPorts, observationUsageSource } from './application/observationPorts';
import { executionWriterObserver, migrationWriterObserver, legacyOwnerObserver } from './adapters/executionWriters';
import { webhookAwareAllowlist } from './application/webhookIngress';
import { objectStorageSources } from './application/objectStorageSources';
import { nativeWorkloadOwnership, originalGatewayPodProject } from './adapters/k8s/workloadOwnership';
import { nativePostgresSource } from './adapters/k8s/nativePostgresSource';
import { assertStorageConsumers } from './adapters/k8s/storageContract'; import { objectTransferOwners } from './adapters/k8s/objectTransferOwners';
import { releaseImagePorts } from './application/releaseImagePorts';
import { eventDeliveryOwners, projectCallbackOwners, provisioningWorkPorts } from './adapters/k8s/eventDeliveryOwners';
import { imageValidationPorts } from './application/imageValidationPorts';
import { businessExecutionPorts, executionHandoffPorts } from './application/businessExecutionPorts';
import { developmentImagePorts, imageOwnerPorts } from './application/developmentImagePorts';
import { executionRecords } from './application/executionRecords';
import { createManagedRuntimeEnvironmentModule, imageAllocationRevision } from '@crewstation/module-runtime-environment';
import { runtimeImagePlatformPorts } from './application/runtimeImagePorts';
import { assertRuntimeImageBuildIsolation } from './adapters/k8s/runtimeImageIsolation';
import { projectHostAccess } from './application/projectHostAccess';
import { rotateDataCredential } from './application/credentialRotation';
import { resourceIdentityDirectory, type Database, type MigrationSet, type ResourceIdentityDirectory, type ReportSnapshotSession } from '@crewstation/persistence';
import { createClusterManagementModule } from '@crewstation/module-cluster-management';
import { createClusterControlModule, type ClusterControlModuleApi, type SlotSpec } from '@crewstation/module-cluster-control';
import { createResourcesModule, type ResourcesModuleApi } from '@crewstation/module-resources';
import { installedSystemComponents } from './domain/systemComponents';
import { BUILTIN_RESOURCES, ServiceIdSchema, type Actor, type ComputeProfileSelector, type ComputeUsage, type ProjectId, type ServiceId, type TaskId, type UserId } from '@crewstation/contracts';
import { eventbusMigrations, type EventConsumer } from '@crewstation/eventbus';
import { secretObject, type K8sClient } from '@crewstation/k8s';
import { forbidden, precondition, type Logger } from '@crewstation/kernel';
import { createAgentRuntimeModule, readProfileObservationName, computeAllocationRevision, taskProfileAllocationRevision } from '@crewstation/module-agent-runtime';
import { createApiCatalogModule, apiAllocationRevision } from '@crewstation/module-api-catalog';
import { createBusinessTaskModule, readBusinessObservationTaskPage, readBusinessObservationAttemptPage, type BusinessTaskModuleApi } from '@crewstation/module-business-task';
import { createCapabilitiesModule } from '@crewstation/module-capabilities';
import { createConfigModule } from '@crewstation/module-config';
import { createDataModule, objectPlanAllocationRevision, objectSpaceAllocationRevision } from '@crewstation/module-data';
import { createDataControlModule, type DataControlModuleApi } from '@crewstation/module-data-control';
import { createDevSessionModule, readDevelopmentObservationTaskPage, readDevelopmentObservationAttemptPage } from '@crewstation/module-dev-session';
import { createEventsModule, type EventsModuleApi } from '@crewstation/module-events';
import { createGatewayModule, gatewayAllocationRevision, projectRateLimitValues, UNAVAILABLE_PATH, type GatewayModuleApi } from '@crewstation/module-gateway';
import { createIdentityModule } from '@crewstation/module-identity';
import { createObservabilityModule, type ObservabilityModuleApi } from '@crewstation/module-observability';
import { createProvisioningModule, type ProjectFacts } from '@crewstation/module-provisioning';
import { createProjectModule, readProjectObservationName, serviceAllocationRevision, namespaceQuotaRevision, executionQuotaRevision, type ProjectModuleApi, type ResolvedService } from '@crewstation/module-project';
import { createReleaseModule, type ReleaseModuleApi } from '@crewstation/module-release';
import { createScmModule } from '@crewstation/module-scm';
import { createSessionModule } from '@crewstation/module-session';
import { createTaskRuntimeModule, type TaskRuntimeModuleApi } from '@crewstation/module-task-runtime';
import { queueMigrations } from '@crewstation/queue';
import { createProjectDeletionSessionClient, createSessionClient } from '@crewstation/session-client';
import type { PlatformSettings } from '@crewstation/settings';
import type { AppEnv } from '@crewstation/http';
import type { Hono } from 'hono';
import type { Lifecycle, PlatformApi } from './api/moduleApi';
/** 组合根的对外形状：各进程只挑选自己角色的入口；模块实例也暴露出来供 CLI 与测试直接使用。 */
export type PlatformModuleApi = PlatformApi<Hono<AppEnv>, MigrationSet>;

export interface PlatformModuleDeps {
  db: Database; runtimeReportSnapshot?: ReportSnapshotSession;
  k8s: K8sClient;
  settings: PlatformSettings;
  logger: Logger;
  /** 工作器租约与事件消费者名的前缀，进程名加主机名。 */
  instance: string;
}
export interface PlatformModule {
  readonly api: PlatformModuleApi;
  readonly modules: ReturnType<typeof composeModules>;
}
/** 平台内部调用用的管理员身份：不经成员关系检查的用例入口。 */
export const SYSTEM_ACTOR: Actor = { userId: BUILTIN_RESOURCES.systemActor as UserId, isAdmin: true };

const consumerLifecycle = (consumer: EventConsumer): Lifecycle => ({ start: () => consumer.start(), stop: () => consumer.stop() });

interface Late { clusterManagement?: ReturnType<typeof createClusterManagementModule>['api']; resourceAccess?: ReturnType<typeof createResourceAccessModule>['api']; observability?: ObservabilityModuleApi; objectHistory?: NonNullable<NonNullable<Parameters<typeof createDataModule>[0]['objects']>['history']>; businessTask?: BusinessTaskModuleApi; events?: EventsModuleApi; project?: ProjectModuleApi; gateway?: GatewayModuleApi; taskRuntime?: TaskRuntimeModuleApi; release?: ReleaseModuleApi; resources?: ResourcesModuleApi; dataControl?: DataControlModuleApi; clusterControl?: ClusterControlModuleApi }

type CompositionDeps = PlatformModuleDeps & { identities: ResourceIdentityDirectory };

function dataPorts(settings: PlatformSettings, late: Late, sources: ReturnType<typeof objectStorageSources>, k8s: PlatformModuleDeps['k8s']): Pick<Parameters<typeof createDataModule>[0], 'ledger' | 'credentials' | 'objects' | 'nativePostgres'> {
  const ledger = () => { if (!late.resources) throw new Error('resources 尚未装配'); return late.resources; };
  const dataControl = () => { if (!late.dataControl) throw new Error('data-control 尚未装配'); return late.dataControl; };
  const objectPlane = () => { const plane = dataControl().objects; if (!plane) throw new Error('对象数据面尚未配置'); return plane; };
  return {
    nativePostgres: { run: (origin, names, effect) => { const work = dataControl().nativePostgres; if (!work) throw precondition('原数据库写入端口尚未装配'); return work.run(origin, names, effect); }, credential: (origin, role) => { const work = dataControl().nativePostgres; if (!work?.credential) throw precondition('原数据库口令端口尚未装配'); return work.credential(origin, role); } },
    objects: { inputApiUrl: `http://cs-api.${settings.systemNamespace}.svc:8087`, transferOwners: objectTransferOwners(k8s, settings.systemNamespace, settings.platformPodUid), sources, provisioning: { deploymentMode: settings.objectStorage?.deploymentMode ?? 'production', apiUrl: settings.objectStorage?.apiUrl ?? `http://api.${settings.serviceDomain}:8088` }, exporterToken: settings.clusterMetrics?.exporterToken ?? '', history: { read: (input) => { if (!late.objectHistory) throw new Error('对象历史指标尚未装配'); return late.objectHistory.read(input); } }, plane: {
      configure: (...args) => objectPlane().configure(...args), prepareRotation: (...args) => { const plane = objectPlane(); if (!plane.prepareRotation) throw precondition('对象凭据轮换不可用'); return plane.prepareRotation(...args); }, probe: (...args) => objectPlane().probe(...args), metrics: () => objectPlane().metrics(),
      inspectWrite: (...args) => objectPlane().inspectWrite?.(...args) ?? Promise.resolve('unknown'), put: (...args) => objectPlane().put(...args), get: (...args) => objectPlane().get(...args), verify: (...args) => objectPlane().verify(...args), remove: (...args) => objectPlane().remove(...args),
    }, tasks: { revision: (id) => { if (!late.businessTask) throw new Error('业务归档修订尚未装配'); return late.businessTask.acceptedArchiveRevision(id); }, accepted: (id) => { if (!late.businessTask) throw new Error('业务终结意图尚未装配'); return late.businessTask.acceptedFinalization(id); }, read: (serviceId, taskId) => { if (!late.businessTask) throw new Error('业务归档身份尚未装配'); return late.businessTask.archiveTask(serviceId, taskId); } } },
    ledger: {
      declare: (input) => ledger().owner('data').declare(input), get: (id) => ledger().get(id), requestRelease: (id, reason) => ledger().owner('data').requestRelease(id, reason),
      presentBindings: async () => (await ledger().list({ kind: 'data-binding' })).filter((record) => record.owner.module === 'data' && record.desired === 'present'),
    },
    ...(settings.dataProvisioning === 'data-control' ? { credentials: {
      credentialOf: (id: string) => dataControl().credentialOf(id),
      rotateCredential: async (id: string, projectId: ProjectId) => {
        if (settings.workloadCreation !== 'ledger' || settings.releaseCreation !== 'ledger') throw new Error('口令轮换需要工作负载与发布均由资源中心创建');
        await rotateDataCredential(ledger(), dataControl(), id, projectId);
      },
    } } : {}),
  };
}

function composeCore(deps: CompositionDeps, late: Late) {
  const { db, settings, logger } = deps;
  const hosts = {
    prodHost: (slug: string) => `${slug}.${settings.userDomain}`,
    previewHost: (slug: string) => `preview.${slug}.${settings.userDomain}`,
    serviceHost: (name: string) => `${name}.${settings.serviceDomain}`,
    platformApiHost: () => `api.${settings.serviceDomain}`,
  };
  const projectApi = (): ProjectModuleApi => { if (!late.project) throw new Error('project 尚未装配'); return late.project; };
  // 配额占用数在 task-runtime（更高层）：project 只声明端口，task-runtime 装配后才有值；
  // 装配期间（迁移、CLI）读到 0 而不是抛错，因为那时本来就没有任务在跑。
  const runningTasks = async (projectId: ProjectId): Promise<number> => (late.taskRuntime ? late.taskRuntime.runningTaskCount(projectId) : 0);
  const gatewayApi = (): GatewayModuleApi => { if (!late.gateway) throw new Error('gateway 尚未装配'); return late.gateway; };

  const identity = createIdentityModule({
    db, logger, legacyIds: deps.identities,
    settings: {
      adminEmails: settings.adminEmails, userDomain: settings.userDomain, cookieDomain: `.${settings.userDomain}`,
      secure: settings.publicScheme === 'https', sessionTtlSeconds: settings.sessionTtlSeconds,
      secretKey: settings.secretKeyBase64, passwordLoginForcedOn: settings.passwordLoginForcedOn,
      ...(settings.bootstrapToken === undefined ? {} : { bootstrapToken: settings.bootstrapToken }),
    },
    // 身份转发按项目覆盖时要把主机里的 slug 换成项目 ID；project 装配在 identity 之后，故经端口惰性取。
    projectDirectory: { idBySlug: async (slug) => (await projectApi().resolveServiceIdentity(`${slug}/${slug}`))?.projectId },
    projectLifecycle: { available: async (id) => {
      try { await projectApi().assertProjectAvailable(id); return true; }
      catch (error) { if (error instanceof Error && 'kind' in error && ['precondition', 'not_found'].includes(String(error.kind))) return false; throw error; }
    } },
    ...projectHostAccess(projectApi),
    // RFC-021：prod 主机的维护放行与 preview 主机的未部署页，判定在 gateway（L5），此处只接线。
    serviceEntry: { check: (userId, slug, slot) => gatewayApi().userEntry(userId, slug, slot) },
    membershipLookup: { membershipsOf: (userId) => projectApi().listUserMemberships(userId) },
    workloadLookup: { byIp: (ip) => gatewayApi().lookupByIp(ip) },
    workloadOwnership: nativeWorkloadOwnership(deps.k8s, projectApi, () => late.release, () => late.taskRuntime, (kind, value) => deps.identities?.resolve(kind, [value]) ?? Promise.resolve(undefined)),
    allowlistEvaluator: webhookAwareAllowlist({ domain: settings.serviceDomain, services: () => projectApi().listServices(), release: () => late.release, maintenance: (id) => gatewayApi().maintenanceOf(id) }, (caller, target) => gatewayApi().evaluate(caller, target)),
    // 开发会话令牌的即时吊销点：每次校验现查环境，释放（releasing／released）即查不到，令牌当场失效。
    // 与 runningTasks 同理，task-runtime 装配前返回 undefined，也就是一律拒绝。
    devSessionState: { activeSession: async (taskId) => {
      const env = await late.taskRuntime?.getEnvironment(taskId);
      return env && env.kind === 'dev-session' && (env.state === 'creating' || env.state === 'running') ? { projectId: env.projectId } : undefined;
    } },
  });
  const project = createProjectModule({ db, identity: identity.api, creationTemplates: { list: () => scm.api.listTemplates(SYSTEM_ACTOR) }, hosts, taskUsage: { runningTasks }, settings: { defaultMaxConcurrentTasks: settings.defaultMaxConcurrentTasks, defaultServicePlan: settings.defaultServicePlan } });
  late.project = project.api;
  const isAdmin = (userId: string) => identity.api.isAdmin(userId as UserId);
  // 申请人／审批人在申请、绑定列表里显示可辨识名字；查不到就让界面回退到 ID。
  const userDirectory = { displayName: async (userId: UserId) => (await identity.api.getUser(userId))?.name };
  const resolveById = (serviceId: ServiceId) => project.api.resolveServiceById(serviceId);

  const config = createConfigModule({ db, project: project.api, settings: { secretKeyBase64: settings.secretKeyBase64 } });
  // 算力档位（RFC-006、ADR-0005）：测试执行在 task-runtime（L4）、已上线引用在 release（L4）、资源套餐在 project（L2），都由这里回填。
  const agentRuntime = createAgentRuntimeModule({
    db, logger, isAdmin: (id) => identity.api.isAdmin(id),
    projects: { authorize: project.api.authorize, name: async (projectId) => (await project.api.resolveServiceOfProject(projectId))?.slug, assertProjectAvailable: project.api.assertProjectAvailable, assertProjectDeletionGrant: project.api.assertProjectDeletionGrant },
    executor: { run: (input, report, heartbeat) => { if (!late.taskRuntime) throw new Error('task-runtime 尚未装配'); return late.taskRuntime.runProfileTest(input, report, heartbeat); } },
    references: { listReferencingProjects: async (profile) => {
      const releaseApi = late.release;
      if (!releaseApi) return [];
      const hits = await Promise.all((await project.api.listServices()).map(async (s) => ((await releaseApi.deployedComputeReferences(s.serviceId)).includes(profile) ? s.slug : undefined)));
      return [...new Set(hits.filter((slug): slug is string => slug !== undefined))].sort();
    } },
    taskProfiles: { exists: async (name) => (await project.api.listTaskProfiles()).some((p) => p.id === name) },
    settings: { defaultTaskProfile: settings.defaultTaskProfile, secretKeyBase64: settings.secretKeyBase64, registry: { pullBase: settings.registryBase, pushHost: settings.registryPushHost, baseRepository: settings.baseImage.repository, runtimePrefix: 'runtime/', scheme: settings.registryScheme, baseTag: settings.baseImage.tag } },
  });
  const data = createDataModule({
    db, logger, isAdmin: (id) => isAdmin(id), authorizer: project.api, users: userDirectory,
    productionTasks: { get: async (id) => { const env = await late.taskRuntime?.getEnvironment(id); return env ? { taskId: id, projectId: env.projectId, serviceId: env.serviceId as ServiceId, kind: env.kind, state: env.state, podUid: (await late.taskRuntime!.resourceWorkload(SYSTEM_ACTOR, id)).podUid } : undefined; }, list: async (id) => { const env = await late.taskRuntime?.findDevSession(id); return env ? [env.id] : []; } },
    services: { resolveServiceById: async (id) => { const r = await resolveById(id); return r ? { projectId: r.projectId, slug: r.slug } : undefined; } },
    settings: { defaultPlan: 'db-small', secretKeyBase64: settings.secretKeyBase64, postgres: settings.dataPostgres },
    ...dataPorts(settings, late, objectStorageSources(identity.api, project.api, () => late.release, () => late.taskRuntime), deps.k8s),
  });
  const scm = createScmModule({ db, logger, project: project.api, identities: deps.identities, ...(settings.platformPodUid ? { processes: projectCallbackOwners(deps.k8s, settings.systemNamespace, settings.platformPodUid, 'crewstation.io/scm-project-stop') } : {}), templateResources: {
    allocate: (kind, context, templateId, slotId) => deps.identities.bind('scm', kind, ['template', context.serviceId, templateId, slotId]),
    ensureDefinition: config.api.ensureTemplateDefinition,
    eventType: async (producerCode, eventCode) => {
      if (!late.events) throw new Error('events 尚未装配');
      return (await late.events.listEventTypes(SYSTEM_ACTOR)).find((entry) => entry.state === 'active' && entry.producer === producerCode && entry.eventType === eventCode)?.id;
    },
  }, settings: { baseUrl: settings.gitlab.baseUrl, groupPath: settings.gitlab.groupPath, platformToken: settings.gitlab.platformToken, platformBotName: settings.gitlab.botName, defaultBranch: 'main' } });
  const apiCatalog = createApiCatalogModule({
    db, projects: { ...project.api, resourceRequestable: async (actor, id, target) => late.resourceAccess ? (await late.resourceAccess.inspect(actor, id, target)).requestable : false }, hosts, logger, users: userDirectory,
    onCatalogChanged: async (serviceId) => { await gatewayApi().reconcileService(serviceId); await gatewayApi().rebuildAllowlist(); },
    services: {
      resolveService: async (id) => { const r = await resolveById(id); return r ? { projectId: r.projectId, serviceId: r.serviceId, slug: r.slug, identity: r.identity } : undefined; },
      resolveServiceIdentity: async (identity) => { const r = await project.api.resolveServiceIdentity(identity); return r ? { projectId: r.projectId, serviceId: r.serviceId, slug: r.slug, identity: r.identity } : undefined; },
    },
  });
  return { identity, project, config, data, scm, apiCatalog, agentRuntime, hosts, isAdmin, resolveById };
}

function composeDelivery(deps: CompositionDeps, core: ReturnType<typeof composeCore>, late: Late, resources: ReturnType<typeof composeLedger>, images: ReturnType<typeof createManagedRuntimeEnvironmentModule>) {
  const { db, k8s, settings, logger } = deps;
  const { project, config, data, scm, apiCatalog, hosts, isAdmin, resolveById } = core;
  const release = createReleaseModule({
    executionHandoff: { observeMigrationStopped: migrationWriterObserver(deps.k8s, core.project.api.resolveServiceById), observeWritersStopped: executionWriterObserver(deps.k8s, core.project.api.resolveServiceById), ...executionHandoffPorts(() => { if (!late.businessTask) throw new Error('business-task 尚未装配'); return late.businessTask; }, () => { if (!late.gateway) throw new Error('gateway 尚未装配'); return late.gateway; }, () => { if (!late.release) throw new Error('release 尚未装配'); return late.release; }) },
    runtimeImages: releaseImagePorts(images.api, { isAdmin, pinServiceImage: images.pinServiceImage, resolveProfile: (projectId, selector) => core.agentRuntime.api.resolveForProject(projectId, selector, 'subtask') }),
    // 服务槽投影进资源台账（RFC-025 第三期）：在 release 自己的事务里写期望与领域条件。T8：槽与构建、迁移 Job 由资源中心建出（CS_RELEASE_CREATION=owner
    // 回退为自己建），重新部署前的集群预检经 cluster-control 按同一份期望渲染（它装配在后，惰性取）。
    ledger: { within: (tx) => resources.api.owner('release').within(tx as object) },
    ...(settings.releaseCreation === 'ledger' ? { creation: 'ledger' as const, renderer: { dryRun: (spec: SlotSpec, env: Readonly<Record<string, string>>) => { if (!late.clusterControl) throw new Error('cluster-control 尚未装配'); return late.clusterControl.dryRunSlot(spec, env); } } } : {}),
    physicalOperationId: async (id) => (await deps.identities.aliases('cluster-operation', id)).find((keys) => keys.length === 1 && keys[0] !== id)?.[0] ?? id,
    db, k8s, hosts, logger, isAdmin: (id) => isAdmin(id), authorizer: project.api, services: { resolveServiceById: resolveById },
    tagger: { createReleaseTag: (serviceId, { branch, version, expectedCommitSha }) => scm.api.createReleaseTag(serviceId, { branch, ...(expectedCommitSha ? { expectedCommitSha } : {}), ...(version.startsWith('v') ? { tag: version } : { bump: version as 'major' | 'minor' | 'patch' }) }) },
    repo: {
      readFile: scm.api.readFile,
      repositoryUrl: async (serviceId) => {
        const [binding, svc, credential] = await Promise.all([scm.api.getBinding(SYSTEM_ACTOR, serviceId), resolveById(serviceId), scm.api.issueSessionCredential(serviceId, 180)]);
        if (!svc) throw new Error(`服务 ${serviceId} 不存在`);
        const name = `git-cred-${serviceId.replaceAll('-', '')}`;
        await k8s.apply(secretObject({ name, namespace: svc.namespace, stringData: { token: credential.token }, labels: { 'crewstation.io/service': svc.name } }));
        return { httpUrl: binding.httpUrl, credentialSecretName: name };
      },
      // T8：资源中心建的构建 Job——地址写进期望，令牌在调和器建凭据 Secret 时才签（时长同上），不再写按服务共用的 Secret。
      buildSource: async (serviceId) => ({ httpUrl: (await scm.api.getBinding(SYSTEM_ACTOR, serviceId)).httpUrl }),
      buildToken: async (serviceId) => ({ token: (await scm.api.issueSessionCredential(serviceId, 180)).token }),
    },
    plans: {
      getServicePlan: async (name, projectId) => projectId ? project.api.resolveProjectServicePlan(projectId, name) : (await project.api.listServicePlans()).find((p) => p.id === name),
      lookupComputeProfile: (name, projectId) => core.agentRuntime.api.lookupForProjectRelease(projectId, name),
      listComputeProfiles: () => core.agentRuntime.api.listNames(),
    },
    config: {
      render: async (projectId, env) => ({ values: await config.api.renderDefinitions(projectId, env), version: await config.api.currentVersion(projectId, env) }),
      validate: (projectId, env, keys) => config.api.validateManifestEnv(projectId, env, keys.map((configDefinitionId) => ({ name: 'CONFIG', configDefinitionId, from: 'config' as const }))),
    },
    data: { envFor: data.api.envFor, ...(data.api.objectEnv ? { objectEnv: data.api.objectEnv } : {}) },
    // RFC-021：项目完整维护即破坏性迁移窗口（gateway 在 release 之后装配，故惰性取）；自动下线的提醒发给负责人。
    maintenance: { open: (serviceId) => { if (!late.gateway) throw new Error('gateway 尚未装配'); return late.gateway.maintenanceWindowOpen(serviceId); } },
    owners: { ownerOf: project.api.ownerOf },
    notifier: { notify: async (projectId, users, message) => { logger.warn('slot offline notice', { projectId, users, message }); } },
    settings: { userDomain: settings.userDomain, serviceDomain: settings.serviceDomain, registryBase: settings.registryBase, buildTimeoutSeconds: 1800, deployTimeoutSeconds: 600, builderImage: settings.builderImage, buildkitAddress: settings.buildkitAddress, workerOwner: `${deps.instance}.release` },
  });
  const directoryService = (s: ResolvedService) => ({ serviceId: s.serviceId, projectId: s.projectId, projectSlug: s.slug, serviceName: s.name, namespace: s.namespace, identity: s.identity, kind: s.kind, archived: s.state === 'archived' });
  // `listServices` 只给在册服务（project 模块已滤掉归档的）；按 id／按项目的解析必须能查到归档的，
  // 否则 `project.archived` 到达网关时服务已经查不到，那个项目的路由就永远留在集群里。
  const listServices = async () => (await project.api.listServices()).map(directoryService);
  const gateway = createGatewayModule({
    identities: deps.identities,
    db, k8s, hosts, logger, isAdmin: (id) => isAdmin(id),
    projects: { assertProjectAvailable: project.api.assertProjectAvailable, assertProjectDeletionGrant: project.api.assertProjectDeletionGrant, availableMany: project.api.availableProjectIds },
    processes: projectCallbackOwners(deps.k8s, settings.systemNamespace, settings.platformPodUid, 'crewstation.io/gateway-project-stop'),
    originals: {
      service: async (key) => { const id = ServiceIdSchema.safeParse(key).success ? key : key.includes('/') ? undefined : await deps.identities?.resolve('service', [key]); const source = id ? await resolveById(id as ServiceId) : await project.api.resolveServiceIdentity(key); return source ? directoryService(source) : undefined; },
      operation: apiCatalog.api.originalOperationProject,
      pod: (record) => originalGatewayPodProject(record, () => project.api, () => release.api, () => late.taskRuntime, (kind, key) => deps.identities?.resolve(kind, [key]) ?? Promise.resolve(undefined)),
    },
    // RFC-025 第三期后半：服务的路由投影成 route 记录（IngressRoute 仍由 gateway 建删）。
    ledger: resources.api.owner('gateway'),
    services: {
      listServices,
      getService: async (id) => { const s = await resolveById(id); return s ? directoryService(s) : undefined; },
      resolveIdentity: async (key) => { const source = await project.api.resolveServiceIdentity(key); return source ? directoryService(source) : undefined; },
      resolveProjectSlug: async (slug) => { const source = await project.api.resolveServiceOfSlug(slug); return source ? directoryService(source) : undefined; },
      serviceIdOfProject: async (projectId) => (await project.api.resolveServiceOfProject(projectId))?.serviceId,
    },
    slots: { slotRoles: release.api.slotRoles, notePreviewAccess: release.api.notePreviewAccess },
    // RFC-025 D13、I26 裁定：说明页由 cs-api 按台账渲染（路由记录与目标槽记录），页面与维护页同源。
    explainer: { reader: { get: (id) => resources.api.get(id), claimOf: (child) => resources.api.claimOf(child) }, page: (entry, context) => core.identity.api.unavailablePage(entry, context) },
    grants: { originalOperationProject: apiCatalog.api.originalOperationProject, grantedOperations: apiCatalog.api.grantedOperations, listCallers: async () => [], proxyNameOf: apiCatalog.api.activeProxyNameOf },
    access: {
      authorize: project.api.authorize,
      // 维护中放行的是来验证的成员；「用户」角色和其他人一样看维护页（2026-09-24）。
      isMemberOrAdmin: async (userId, projectId) => { const role = await project.api.roleOf({ userId, isAdmin: await project.api.isAdmin(userId) }, projectId); return role !== undefined && role !== 'user'; },
    },
    users: { describe: async (userId) => { const user = await core.identity.api.getUser(userId); return user ? { name: user.name, email: user.email } : undefined; } },
    settings: { systemNamespace: settings.systemNamespace, serviceDomain: settings.serviceDomain, userAuthMiddleware: 'forward-auth-user', serviceAuthMiddleware: 'forward-auth-service', dropIdentityHeadersMiddleware: 'drop-identity-headers', allowlistMaxStaleSeconds: 300, consumerName: 'gateway' },
  });
  late.gateway = gateway.api;
  late.release = release.api;
  return { release, gateway };
}

function composeRuntime(deps: CompositionDeps, core: ReturnType<typeof composeCore>, delivery: ReturnType<typeof composeDelivery>, late: Late, resources: ReturnType<typeof composeLedger>, runtimeImages: ReturnType<typeof createManagedRuntimeEnvironmentModule>) {
  const { db, k8s, settings, logger } = deps;
  const { project, config, data, scm, isAdmin, resolveById } = core;
  const { release } = delivery;
  const testRunner = createSessionClient(settings.sessionInternalUrl);
  const mcp = [{ name: 'capabilities', url: settings.mcp.capabilitiesUrl }, { name: 'operations', url: settings.mcp.operationsUrl }];
  const ledger = resources.api.owner('task-runtime');
  const taskRuntime = createTaskRuntimeModule({
    deletionStops: runtimeCleanupPorts(project.api, resources.api, () => devSession.api, createProjectDeletionSessionClient(settings.sessionInternalUrl)),
    ...(settings.platformPodUid ? { deletionWorkSources: runtimeDeletionSources(project.api, () => late.businessTask, projectCallbackOwners(k8s, settings.systemNamespace, settings.platformPodUid, 'crewstation.io/runtime-project-stop')) } : {}),
    ...(data.api.archiveHelper ? { archive: { credentials: data.api.archiveHelper, apiUrl: `http://cs-api.${settings.systemNamespace}.svc:8087` } } : {}),
    imageProbeLeases: { port: resources.api.leases, holder: deps.instance },
    db, k8s, logger, isAdmin: (id) => isAdmin(id), authorizer: project.api, quotas: { quotaLimit: project.api.quotaLimit }, testRunner, testMcp: mcp,
    // RFC-025 第二期：环境落库时在同一事务里投影进资源台账；live 给补投影列出台账里还挂着的 task-runtime 记录。
    // 额度经台账受理（D31：按阶段数，结束中仍占），occupancy 是项目眼下占用的额度单位。
    workloadSafety: resources.api.workloadSafety, taskVolumes: resources.api.taskVolumes, ledger: { within: (tx) => ledger.within(tx as object), live: async () => (await resources.api.list({})).filter((record) => record.owner.module === 'task-runtime'), occupancy: resources.api.occupancy },
    // RFC-025 I25：工作区（开发会话、业务任务）的容器由资源中心照记录建出，受理只写期望（不含凭据）；运维开关可回退为本模块自己建。
    ...(settings.workloadCreation === 'ledger' ? { creation: 'ledger' as const } : {}),
    profiles: { devSessionProfile: core.agentRuntime.api.projectDevTaskProfile, listTaskProfiles: project.api.listTaskProfiles, getTaskProfile: async (name) => (await project.api.listTaskProfiles()).find((p) => p.id === name) },
    services: { resolveServiceById: resolveById },
    checkout: runtimeCheckout(scm.api, SYSTEM_ACTOR, k8s, resolveById),
    sources: { ...(data.api.objectEnv ? { objectEnv: data.api.objectEnv } : {}), taskInputEnv: (input) => { if (!data.api.taskInputs) throw precondition('任务对象输入不可用'); return data.api.taskInputs.environment(input); }, bindTaskInputs: (id, uid) => { if (!data.api.taskInputs) throw precondition('任务对象输入不可用'); return data.api.taskInputs.bind(id, uid); }, pinTaskImage: runtimeImages.pinPlatformImage, runtimeImageSecrets: runtimeImages.api.renderInitializationSecrets, configEnv: (projectId, env) => config.api.renderEnv(projectId, env), dataEnv: data.api.envFor, taskDataEnv: data.api.envForTask },
    settings: { taskImage: settings.taskImage, systemNamespace: settings.systemNamespace, sessionUrl: settings.sessionRunnerUrl, userDomain: settings.userDomain, serviceDomain: settings.serviceDomain, workerUid: 10001, defaultProfile: settings.defaultTaskProfile, userAuthMiddleware: 'forward-auth-user', dropIdentityHeadersMiddleware: 'drop-identity-headers', previewRateMiddlewares: ['rate-limit-user', 'rate-limit-host'] },
  });
  late.taskRuntime = bindTaskMaintenance(resources.api, taskRuntime.api);
  const runner = createSessionClient(settings.sessionInternalUrl);
  // 两类任务共用解析：受理固定档位修订，派发时取材料，凭据仅进入受控 Runner 通道。
  const computeCatalog = { pinLaunchVersion: core.agentRuntime.api.pinLaunchVersion, launchMaterialAt: core.agentRuntime.api.launchMaterialAt, resolve: (name: ComputeProfileSelector | undefined, usage: ComputeUsage, projectId: ProjectId) => core.agentRuntime.api.resolveForProject(projectId, name, usage), launchMaterial: core.agentRuntime.api.launchMaterial, launchMetadata: core.agentRuntime.api.launchMetadata };
  const devSession = createDevSessionModule({
    projectDeletionSession: developmentDeletionSession(project.api, createProjectDeletionSessionClient(settings.sessionInternalUrl)),
    ...(settings.platformPodUid ? { deletionWorkSources: developmentDeletionSources(project.api, taskRuntime.api, () => late.clusterManagement, projectCallbackOwners(k8s, settings.systemNamespace, settings.platformPodUid, 'crewstation.io/development-project-stop')) } : {}),
    developmentUsagePricing: developmentObservationAdmission(() => late.observability),
    runtimeImages: developmentImagePorts(runtimeImages.api),
    identities: deps.identities,
    // RFC-025 §11.2：名册的结束与失败照台账里执行记录的阶段（记录沿用执行环境的任务 ID，上级是工作区）。
    executions: executionRecords(resources.api),
    apiCatalog: core.apiCatalog.api,
    db, logger, isAdmin: (id) => isAdmin(id), environments: taskRuntime.api, runner, releases: release.api,
    scm: developmentSourceControl(scm.api, SYSTEM_ACTOR),
    authorizer: { authorize: project.api.authorize, ownerOf: project.api.ownerOf },
    services: { resolveServiceOfProject: project.api.resolveServiceOfProject },
    notifier: { notify: async (projectId, users, message, context) => { logger.warn('dev session notice', { projectId, users, message, taskId: context.taskId }); } },
    // 注入 Agent 的远程 MCP 连接凭据由 identity 签发：一个签发者、一个密钥环、一份 JWKS。
    credentials: { issueDevSessionToken: (binding) => core.identity.api.issueDevSessionToken(binding) },
    compute: computeCatalog,
    settings: { idleMinutes: settings.idleMinutes, userDomain: settings.userDomain, mcp, defaultPreviewPort: 3000 },
  });
  const businessTask = createBusinessTaskModule({ ...businessRuntimePorts(core.data.api, taskRuntime.api, project.api, () => late.businessTask, settings.platformPodUid ? projectCallbackOwners(k8s, settings.systemNamespace, settings.platformPodUid, 'crewstation.io/business-project-stop') : undefined), taskStorageStatus: (id) => settings.workloadCreation === 'ledger' ? core.data.api.taskStorageStatus(id) : Promise.resolve({ available: false, reason: 'workload_safety_unavailable' }), taskInputs: core.data.api.taskInputs, executionObservations: businessObservationAdmission(() => late.observability), storageControl: { apply: core.data.api.applyObjectWriteControl }, legacyRecoveryProof: legacyOwnerObserver(deps.k8s, settings.systemNamespace), ...businessExecutionPorts(runtimeImages.api, core.config.api, core.identity.api, SYSTEM_ACTOR),
    identities: deps.identities,
    db, logger, isAdmin: (id) => isAdmin(id), environments: taskRuntime.api, runner, authorizer: project.api,
    directory: { resolveServiceIdentity: async (identity) => { const r = await project.api.resolveServiceIdentity(identity); return r ? { serviceId: r.serviceId, projectId: r.projectId } : undefined; } },
    compute: computeCatalog,
    settings: { legacyFixedAdmission: settings.workloadCreation === 'ledger', legacyOwnerPodUid: settings.platformPodUid, mcp, outputLimitBytes: 262144, consumerName: 'business-task', secretKeyBase64: settings.secretKeyBase64 },
  });
  const events = createEventsModule({
    db, logger, projects: project.api,
    ingressSource: { resolve: async ({ identity, token }) => { const source = token ? await core.identity.api.resolveEventSource(token) : undefined; return source?.identity === identity ? source : undefined; } },
    processes: eventDeliveryOwners(deps.k8s,settings.systemNamespace,settings.platformPodUid),
    services: { resolveService: async (id) => { const r = await resolveById(id); return r ? { projectId: r.projectId, serviceId: r.serviceId, slug: r.slug, identity: r.identity } : undefined; } },
    endpoints: { resolve: async (serviceId) => { const [ep, svc] = await Promise.all([release.api.activeEndpoint(serviceId), resolveById(serviceId)]); return ep && svc ? { baseUrl: `http://${svc.slug}.${settings.serviceDomain}` } : undefined; } },
    hold: { holds: (serviceId) => delivery.gateway.api.holdsEvents(serviceId) },
    worker: { owner: `${deps.instance}.events`, concurrency: 4 },
  });
  const session = createSessionModule({
    identities: deps.identities, deletionSources: sessionDeletionSources(taskRuntime.api, project.api, settings.platformPodUid ? projectCallbackOwners(k8s, settings.systemNamespace, settings.platformPodUid, 'crewstation.io/session-project-stop') : undefined),
    db, logger, isAdmin: (id) => isAdmin(id),
    runnerAuth: { verifyRunnerToken: taskRuntime.api.verifyRunnerToken },
    taskAccess: {
      canOpenStream: async (actor, id) => taskRuntime.api.canOpenStream({ ...actor, isAdmin: await core.isAdmin(actor.userId) }, id),
      // 先把环境标成已连接，再派发等容器就绪的业务子任务：提交子任务时容器往往还没连上。
      // 派发不能 await：这个回调跑在 cs-session 处理 hello 的串行链上，而派发要等 TaskRunner
      // 的回执——回执要经同一条链回来，等下去必然自锁到命令超时。
      onRunnerConnected: taskRuntime.api.onRunnerConnected,
      onRunnerReady: (taskId) => {
        void devSession.api.dispatchPendingNativeExecution(taskId).catch(() => logger.error('dispatch native execution failed', { taskId }));
        void businessTask.api.dispatchPendingSubtasks(taskId)
          .then((dispatched) => { if (dispatched > 0) logger.info('dispatched pending subtasks', { taskId, dispatched }); })
          .catch((error: unknown) => logger.error('dispatch pending subtasks failed', { taskId, error: error instanceof Error ? error.message : String(error) }));
      },
      onRunnerDisconnected: taskRuntime.api.onRunnerDisconnected,
      onRunnerRejected: taskRuntime.api.onRunnerRejected,
    },
    settings: { selfAddress: settings.selfAddress, commandTimeoutMs: 30_000, runnerStaleMs: 30_000, replayLimit: 2000 },
  });
  late.events = events.api;
  late.businessTask = businessTask.api;
  return { taskRuntime, devSession, businessTask, events, session, sessionClient: runner };
}

function composeAggregates(deps: CompositionDeps, late: Late, core: ReturnType<typeof composeCore>, delivery: ReturnType<typeof composeDelivery>, runtime: ReturnType<typeof composeRuntime>, resources: ReturnType<typeof composeLedger>, images: ReturnType<typeof createManagedRuntimeEnvironmentModule>) {
  const { db, k8s, settings, logger } = deps;
  const { project, config, data, apiCatalog, isAdmin } = core;
  const serviceOfProject = project.api.resolveServiceOfProject;
  const observability = createObservabilityModule({ reportSnapshot:deps.runtimeReportSnapshot,reportDataRoot:settings.runtimeReportDataRoot,reportFacts:completeRuntimeFactSources({business:{tasks:readBusinessObservationTaskPage,attempts:readBusinessObservationAttemptPage},development:{tasks:readDevelopmentObservationTaskPage,attempts:readDevelopmentObservationAttemptPage},projectName:readProjectObservationName,profileName:readProfileObservationName}),
    deletion: { identities: deps.identities, assertGrant: project.api.assertProjectDeletionGrant,
      tasks: { list: (target) => originalObservationTasks(runtime.taskRuntime.api, target.id) },
      originalUsage: originalObservationUsage(project.api, createProjectDeletionSessionClient(settings.sessionInternalUrl), runtime.businessTask.api.v3, runtime.devSession.api.developmentUsage) },
    ...(runtime.devSession.api.developmentUsage ? { developmentUsageSource: developmentObservationSource(runtime.devSession.api.developmentUsage, runtime.session.api) } : {}), usageSource: observationUsageSource(runtime.businessTask.api.v3, runtime.session.api), ...observationPorts(runtime.businessTask.api.v3, project.api, core.agentRuntime.api, resources.api),
    db, k8s, logger, isAdmin: (id) => isAdmin(id), authorizer: project.api, services: { resolveServiceOfProject: serviceOfProject }, slots: delivery.release.api,
    traces: {
      environments: { traceKeys: runtime.taskRuntime.api.traceKeys, activeTraceIds: runtime.taskRuntime.api.activeTraceIds, list: runtime.taskRuntime.api.listTraceEnvironments },
      deliveries: { traceKeys: runtime.events.api.traceKeys, activeTraceIds: runtime.events.api.activeTraceIds, list: runtime.events.api.listTraceDeliveries },
      businessTasks: { list: runtime.businessTask.api.listTraceTasks },
      sessions: { summarize: runtime.session.api.summarizeEvents, events: (taskId, page) => runtime.session.api.listEvents(taskId, { sinceSeq: page.afterSeq, limit: page.limit, kinds: page.kinds }) },
    },
    listProjectIds: async () => (await project.api.listServices()).map((s) => s.projectId),
  });
  late.observability = observability.api;
  const resourceState = projectResourceState(k8s, { actor: SYSTEM_ACTOR, service: serviceOfProject, namespace: project.api.getNamespaceQuota, namespaceRevision: namespaceQuotaRevision, gateway: delivery.gateway.api.getProjectRateLimits, allowlist: delivery.gateway.api.currentAllowlist });
  const resourceAccess = createResourceAccessModule({ db, project: project.api, instance: deps.instance, logger, userName: async (id) => (await core.identity.api.getUser(id))?.name ?? null,
    adapters: resourceCatalogs({ actor: SYSTEM_ACTOR, project: project.api, compute: core.agentRuntime.api, images: images.api, objects: data.api.objects, api: apiCatalog.api, gateway: delivery.gateway.api, production: data.api,
      revisions: { service: serviceAllocationRevision, namespace: namespaceQuotaRevision, execution: executionQuotaRevision, compute: computeAllocationRevision, task: taskProfileAllocationRevision, image: imageAllocationRevision, objectPlan: objectPlanAllocationRevision, objectSpace: objectSpaceAllocationRevision, api: apiAllocationRevision, gateway: gatewayAllocationRevision, gatewayValues: projectRateLimitValues },
      reapplyNamespace: (id) => provisioning.api.reapplyProjectNamespace(id), ...resourceState,
    }),
  });
  late.resourceAccess = resourceAccess.api;
  const capabilities = createCapabilitiesModule({
    isAdmin: (id) => isAdmin(id),
    resourceCenter: { authorize: project.api.authorize, project: project.api.getProject, targets: resourceAccess.api.targets, requests: (actor, id) => resourceAccess.api.list(actor, id, { limit: 100 }),
      activeRequests: async (actor, id) => { const items = []; let cursor: string | undefined; for (let page = 0; page < 5; page++) { const result = await resourceAccess.api.list(actor, id, { limit: 100, inFlight: 'true', ...(cursor ? { cursor } : {}) }); items.push(...result.items); if (!result.nextCursor) return { items, nextCursor: null }; cursor = result.nextCursor; } return { items, nextCursor: cursor ?? null }; },
      ...projectResourceSources({ actor: SYSTEM_ACTOR, service: serviceOfProject, ledger: (actor, id) => resources.api.view(actor, id, {}), repository: core.scm.api.getBinding, releases: delivery.release.api.listReleases, slots: delivery.release.api.getSlots, releaseUsage: delivery.release.api.resourceUsage, workloads: runtime.taskRuntime.api.resourceWorkloads, config: config.api.listItems, data: data.api.listResources, spaces: data.api.objects?.spaces, bindings: (actor, id) => data.api.listProjectBindings(actor, id), apiRequests: (actor, id) => apiCatalog.api.listRequests(actor, id), subscriptions: runtime.events.api.listSubscriptions, imageVersion: images.api.getVersion, quota: resourceState.quotaObject, mcp: [{ name: 'capabilities', url: settings.mcp.capabilitiesUrl }, { name: 'operations', url: settings.mcp.operationsUrl }] }),
    },
    market: { list: project.api.listMarketListings, get: project.api.getMarketListing, slots: (serviceId) => delivery.release.api.getSlots(SYSTEM_ACTOR, serviceId), maintenance: (serviceId) => delivery.gateway.api.maintenanceOf(serviceId) },
    projects: { list: project.api.listProjectPage, read: project.api.readProjectPageEntries, get: project.api.getProjectPageEntry,
      resources: (actor, projectId) => resources.api.view(actor, projectId, { kind: 'dev-workspace', includeStopped: 'true' }),
      session: (projectId) => runtime.taskRuntime.api.findDevSession(projectId, { includeLatestFailure: true }), slots: delivery.release.api.getSlots, preview: delivery.release.api.getPreviewSlot, health: observability.api.health,
      releases: delivery.release.api.listReleases, switches: delivery.release.api.listTrafficSwitches },
    settings: { userDomain: settings.userDomain, serviceDomain: settings.serviceDomain, mcp: [{ name: 'capabilities', url: settings.mcp.capabilitiesUrl }, { name: 'operations', url: settings.mcp.operationsUrl }], defaultServicePlan: settings.defaultServicePlan },
    sources: {
      resolveServiceOfProject: serviceOfProject, authorize: project.api.authorize, quota: project.api.getQuota, servicePlans: project.api.listProjectServicePlans,
      computeProfiles: core.agentRuntime.api.listProjectSummaries,
      configKeys: async (actor, projectId, env) => (await config.api.listItems(actor, projectId, env)).map((i) => i.name),
      dataResources: data.api.listResources, operations: (actor, serviceId) => apiCatalog.api.listOperations(actor, serviceId),
      subscriptions: (actor, projectId) => runtime.events.api.listSubscriptions(actor, projectId),
      identityForwarding: (projectId) => core.identity.api.effectiveForwarding(projectId),
    },
  });
  const provisioning = createProvisioningModule({
    db, logger, ...provisioningWorkPorts(k8s, settings.systemNamespace, settings.platformPodUid, project.api), workerOwner: `${deps.instance}.provisioning`, consumerName: 'provisioning', isAdmin: (id) => isAdmin(id),
    authorizeRetry: async (actor, id) => {
      const role = await project.api.authorize(actor, id, 'view');
      if (role !== 'owner' && role !== 'admin') throw forbidden('只有负责人或管理员可以重新开通项目');
      if ((await project.api.getProject(actor, id)).state !== 'failed') throw precondition('只有开通失败的项目可以重试');
    },
    // 命名空间、额度与网络策略写成台账记录（RFC-025 第四期），由 cluster-control 的调和器建出、被改或被删就补回。
    ledger: { declare: (input) => resources.api.owner('provisioning').declare(input), get: (id) => resources.api.get(id) },
    namespaces: { systemNamespace: settings.systemNamespace, quota: project.api.namespaceQuota },
    cleanup: { project: (id) => project.api.getProject(SYSTEM_ACTOR, id), record: resources.api.get, retire: resources.api.retireNamespace,
      inspect: (name, uid, children) => late.clusterControl!.inspectNamespaceRetirement(name, { uid, children }) },
    steps: {
      loadProject: project.api.getProvisioningProject,
      // 走与开通链同一个装载器：它自己会挡掉已归档和没有服务的项目，过滤规则只有这一份。
      // 启动时跑一次，N+1 次查询可以接受。
      listProjects: async () => {
        const directory = await project.api.listClusterProjects();
        const facts = await Promise.all(directory.map((p) => project.api.getProvisioningProject(p.projectId as ProjectId)));
        return facts.filter((f): f is ProjectFacts => f !== undefined);
      },
      ensureRepository: async (f) => { await core.scm.api.ensureRepository(f.serviceId, f.projectId, { slug: f.slug, templateId: f.template, ...(f.initialPlan === undefined ? {} : { initialPlan: f.initialPlan }) }); },
      ensureData: async (f) => { await data.api.ensureServiceData(f.serviceId); },
      reconcileRoutes: async (f) => { await delivery.gateway.api.reconcileService(f.serviceId); },
      ensureFirstRelease: async (f) => { if ((await delivery.release.api.listReleases(SYSTEM_ACTOR, f.serviceId)).length === 0) await delivery.release.api.publish(SYSTEM_ACTOR, f.serviceId, { branch: 'main', version: 'v0.1.0' }); },
      setProjectState: async (projectId, state, message) => { await project.api.setProjectState(projectId, state, message); },
    },
  });
  resources.api.registerActionHandler('provisioning', async ({ actor, record, action }) => {
    if (action !== 'delete-namespace') throw precondition('命名空间不支持此操作');
    await provisioning.api.deleteNamespace(actor, record.id);
  });
  return { observability, capabilities, provisioning, resourceAccess };
}

/**
 * RFC-025 资源中心：台账（L1）只依赖 project 的额度与授权，装在领域模块之前，之后各期的所属模块在构造时就能拿到写入口；
 * 调和器（L2）要按旧标签查任务环境做收编空跑，装在 runtime 之后。
 */
function composeLedger(deps: CompositionDeps, core: ReturnType<typeof composeCore>) {
  const project = core.project.api;
  return createResourcesModule({
    db: deps.db, logger: deps.logger, isAdmin: core.identity.api.isAdmin,
    projectAvailable: project.assertProjectAvailable,
    quotas: { limitFor: project.quotaLimit },
    authorizer: { projectAccess: async (actor, projectId) => ({ operate: (await project.authorize(actor, projectId, 'view')) !== 'tester' }) },
  });
}

function composeControl(deps: CompositionDeps, core: ReturnType<typeof composeCore>, ledger: ReturnType<typeof composeLedger>, runtime: ReturnType<typeof composeRuntime>, { gateway, release }: ReturnType<typeof composeDelivery>, runtimeImages: ReturnType<typeof createManagedRuntimeEnvironmentModule>) {
  return createClusterControlModule({
    ...(runtime.taskRuntime.api.archiveExecution ? { archives: runtime.taskRuntime.api.archiveExecution } : {}),
    k8s: deps.k8s, logger: deps.logger, isAdmin: core.identity.api.isAdmin, systemNamespace: deps.settings.systemNamespace, ...(deps.settings.clusterMetrics ? { volumeProbe: deps.settings.clusterMetrics } : {}),
    // 多副本分工（RFC-025 设计 §6.3）：逐条调和与孤儿回收在资源中心的租约下进行，持有者是这个副本。
    leases: { port: ledger.api.leases, holder: `${deps.instance}.cluster-control` },
    // RFC-025 设计 §7.4：身份索引改读观测缓存的 Pod，全平台只剩这一条 Pod watch。
    pods: { changed: (pod, gone) => gateway.api.syncObservedPod(pod, gone), synced: async (pods) => { await gateway.api.relistObservedPods(pods); } },
    // D13：槽「已结束」时待验证与正式主机改指 cs-api 的说明页（Service 与端口同平台路由清单 deploy/k8s/platform/30-cs-api.yaml）。
    explainer: { namespace: deps.settings.systemNamespace, service: 'cs-api', port: 8080, path: UNAVAILABLE_PATH },
    // RFC-025 I25：建工作区与执行环境的 Runner Secret 时回头向 task-runtime 要内容（值不落台账），Pod 建出后交回实例；执行环境的父工作区变了交它判失败。
    workloads: { inspectDevelopmentRemoval: runtime.taskRuntime.api.inspectDevelopmentRemoval, reconcileRebuild: (id, rebuildId, operations, heartbeat) => runtime.taskRuntime.api.reconcileRebuild(id as TaskId, rebuildId, operations, heartbeat), runnerValues: (id) => runtime.taskRuntime.api.runnerValues(id as TaskId), checkoutValues: (id) => runtime.taskRuntime.api.checkoutValues(id as TaskId), bindWorkload: (id, podUid, secretUid) => runtime.taskRuntime.api.bindWorkload(id as TaskId, podUid, secretUid),
      workloadUnavailable: (id, code) => runtime.taskRuntime.api.workloadUnavailable(id as TaskId, code) },
    // T8：建服务槽的环境 Secret、构建与迁移 Job 的凭据 Secret 时同样回头向 release 要内容；槽建不成交它判这一次部署失败。
    slots: { slotEnvValues: (ref) => release.api.slotEnvValues(ref), slotFailed: (ref, message) => release.api.slotFailed(ref, message) }, jobs: { jobEnvValues: (ref) => release.api.jobEnvValues(ref), imageBuildSecretValues: runtimeImages.imageBuildSecretValues },
    ledger: {
      workloadSafety: ledger.api.workloadSafety, taskVolumes: ledger.api.taskVolumes,
      withProjectAdmission: (id, work) => ledger.api.projectDeletion.withAdmission(id as ProjectId, work),
      observe: (input) => ledger.api.observe(input), claimOf: (child) => ledger.api.claimOf(child), get: (id) => ledger.api.get(id),
      routeCandidates: (host, pathPrefix) => ledger.api.list({ kind: 'route', includeStopped: true, routeMatch: { host, ...(pathPrefix ? { pathPrefix } : {}) } }),
      listLive: () => ledger.api.list({}), changesSince: ledger.api.changesSince, latestChange: ledger.api.latestChange,
      observeConditions: (id, conditions) => ledger.api.observeConditions(id, conditions), children: (parentId) => ledger.api.list({ parentId, includeStopped: true }),
      // 孤儿 PVC 由资源中心自己认领：工作卷记录归 cluster-control，写「待回收」等管理员确认（设计 §6.4）。
      adoptOrphanVolume: async (child) => {
        const record = await ledger.api.owner('cluster-control').declare({ kind: 'volume', ref: `orphan:${child.namespace ?? ''}/${child.name}`, ...(child.projectId ? { projectId: child.projectId as ProjectId } : {}), spec: { children: [{ kind: child.kind, ...(child.namespace ? { namespace: child.namespace } : {}), name: child.name }] }, display: { mode: 'orphaned' } });
        await ledger.api.observeConditions(record.id, [{ type: 'PendingReclaim', status: 'true', reason: 'orphaned', message: '集群里有、台账里没有的工作卷：留作待回收，由管理员确认后删除' }]);
      },
    },
    legacy: {
      resolveTaskId: (legacyId) => deps.identities.resolve('task', [legacyId]),
      task: async (taskId) => {
        const env = await runtime.taskRuntime.api.getEnvironment(taskId as TaskId);
        return env ? { kind: env.kind, state: env.state, execution: Boolean(env.native), lastActivityAt: env.lastActivityAt } : undefined;
      },
    },
  });
}

/** RFC-025 第四期：数据面的调和（L2）——观测平台数据库集群上的库与角色，写回 data 的 `database`／`data-binding` 记录。 */
function composeDataControl(deps: CompositionDeps, ledger: ReturnType<typeof composeLedger>, project: ProjectModuleApi) {
  const resources = ledger.api;
  return createDataControlModule({
    // I28：口令表在平台库里，用平台密钥加密。
    adminUrl: deps.settings.dataPostgres.adminUrl, logger: deps.logger, db: deps.db, secretKeyBase64: deps.settings.secretKeyBase64,
    projectAvailable: project.assertProjectAvailable, processes: projectCallbackOwners(deps.k8s, deps.settings.systemNamespace, deps.settings.platformPodUid, 'crewstation.io/data-control-native-stop'),
    ...(deps.settings.clusterMetrics ? { nativePostgresSource: nativePostgresSource(deps.k8s, { namespace: deps.settings.systemNamespace, service: 'postgres', adminUrl: deps.settings.dataPostgres.adminUrl, ...deps.settings.clusterMetrics }) } : {}),
    observer: { leases: { port: resources.leases, holder: `${deps.instance}.data-control` } },
    ledger: {
      get: (id) => resources.get(id), changesSince: resources.changesSince, latestChange: resources.latestChange, observe: (input) => resources.observe(input),
      listLive: async () => [...await resources.list({ kind: 'database' }), ...await resources.list({ kind: 'data-binding' })],
    },
  });
}
function composeModules(deps: CompositionDeps) {
  const late: Late = {};
  const core = composeCore(deps, late);
  const resources = composeLedger(deps, core);
  late.resources = resources.api;
  const runtimeEnvironment = createManagedRuntimeEnvironmentModule({
    ...imageOwnerPorts(() => late),
    validationExecutor: imageValidationPorts({ authorize: core.project.api.authorize, isAdmin: core.isAdmin, launchMaterial: core.agentRuntime.api.launchMaterial, runtime: () => { if (!late.taskRuntime) throw new Error('task-runtime 尚未装配'); return late.taskRuntime; } }),
    ...runtimeImagePlatformPorts({ project: core.project.api, scm: core.scm.api, config: core.config.api, compute: core.agentRuntime.api, isAdmin: core.isAdmin }, deps.settings), db: deps.db, k8s: deps.k8s, logger: deps.logger, instance: deps.instance, isAdmin: core.isAdmin,
    ledger: { get: resources.api.get, within: (tx) => resources.api.owner('runtime-environment').within(tx) }, leases: resources.api.leases, assertBuildIsolation: () => assertRuntimeImageBuildIsolation(deps.k8s, deps.settings.registryBase),
  });
  const delivery = composeDelivery(deps, core, late, resources, runtimeEnvironment);
  const runtime = composeRuntime(deps, core, delivery, late, resources, runtimeEnvironment);
  const aggregates = composeAggregates(deps, late, core, delivery, runtime, resources, runtimeEnvironment);
  const cluster = composeCluster(deps, core, delivery, runtime, resources);
  late.clusterManagement = cluster.api;
  late.objectHistory = { read: cluster.objectHistory };
  const clusterControl = composeControl(deps, core, resources, runtime, delivery, runtimeEnvironment);
  const dataControl = composeDataControl(deps, resources, core.project.api);
  late.dataControl = dataControl.api;
  late.clusterControl = clusterControl.api;
  return { cluster, resources, clusterControl, dataControl, runtimeEnvironment, identity: core.identity, project: core.project, config: core.config, data: core.data, scm: core.scm, apiCatalog: core.apiCatalog, agentRuntime: core.agentRuntime, ...delivery, ...runtime, ...aggregates };
}

export function createPlatformModule(deps: PlatformModuleDeps): PlatformModule {
  let migrations: MigrationSet[] = [];
  const identities = resourceIdentityDirectory(deps.db, () => migrations);
  const m = composeModules({ ...deps, identities });
  const api: PlatformModuleApi = {
    name: 'platform', storageContract: { ...m.data.api.storageContract, enable: async () => { await assertStorageConsumers(deps.k8s, deps.settings.systemNamespace, m.data.api.storageContract.version); await m.data.api.storageContract.enable(); } },
    initializePlatformRoles: () => m.identity.api.initializePlatformRoles(), bootstrapAdmin: (raw) => m.identity.api.bootstrapAdmin(raw),
    routers: {
      controller: [...m.cluster.internalHttp, ...m.data.internalHttp],
      transfers: [...m.identity.http.devSessionGate, ...m.data.transferHttp],
      // devSessionGate 只挂中间件不占路径，必须排在最前：Hono 按注册顺序执行，晚于业务路由就来不及改判身份。
      api: [...m.identity.http.devSessionGate, ...m.project.http, ...m.identity.http.users, ...m.config.http, ...m.agentRuntime.http, ...m.runtimeEnvironment.http, ...m.data.http, ...m.scm.http, ...m.apiCatalog.http, ...m.release.http, ...m.gateway.http, ...m.taskRuntime.http, ...m.devSession.http, m.businessTask.http.service, m.businessTask.http.user, ...m.events.http.query, ...m.observability.http, ...m.cluster.http, ...m.capabilities.http, ...m.provisioning.http, ...m.clusterControl.http, ...m.resources.http, ...m.resourceAccess.http],
      auth: [...m.identity.http.auth, ...m.identity.http.forwardAuth, ...m.agentRuntime.forwardAuth],
      session: [m.session.http.runner, m.session.http.stream, m.session.http.internal],
      events: [...m.events.http.ingress],
    },
    background: {
      controller: [...m.cluster.workers, ...m.data.workers, ...m.release.workers, ...m.gateway.workers, consumerLifecycle(m.gateway.subscriptions), ...m.taskRuntime.workers, ...m.agentRuntime.workers, ...m.runtimeEnvironment.workers, ...m.devSession.workers, ...m.businessTask.workers, consumerLifecycle(m.businessTask.subscriptions), ...m.apiCatalog.subscriptions.map(consumerLifecycle), ...m.data.subscriptions.map(consumerLifecycle), ...m.observability.workers, ...m.provisioning.workers, ...m.provisioning.startupTasks, consumerLifecycle(m.provisioning.subscriptions), m.resources.maintenanceWorker, m.clusterControl.observer, m.dataControl.observer, m.scm.observer, ...m.resourceAccess.workers,m.events.recoveryWorker],
      // 资源推送流的尾随器（RFC-025 设计 §8.2）：每个 cs-api 副本一个。
      api: [m.resources.streamWorker,...m.observability.reportWorkers],
      session: [...m.session.workers],
      events: [...m.events.workers, ...m.events.subscriptions.map(consumerLifecycle)],
    },
    websocket: m.session.websocket,
    migrations: [queueMigrations, eventbusMigrations, m.resources.migrations, m.identity.migrations, m.project.migrations, m.config.migrations, m.agentRuntime.migrations, m.runtimeEnvironment.migrations, m.data.migrations, m.scm.migrations, m.apiCatalog.migrations, m.events.migrations, m.release.migrations, m.taskRuntime.migrations, m.devSession.migrations, m.businessTask.migrations, m.session.migrations, m.gateway.migrations, m.observability.migrations, m.cluster.migrations, m.dataControl.migrations, m.resourceAccess.migrations, m.provisioning.migrations],
  };
  migrations = api.migrations;
  return { api, modules: m };
}

function composeCluster(deps: CompositionDeps, core: ReturnType<typeof composeCore>, delivery: ReturnType<typeof composeDelivery>, runtime: ReturnType<typeof composeRuntime>, resources: ReturnType<typeof composeLedger>) {
  const tasks = runtime.taskRuntime.api, dev = runtime.devSession.api, business = runtime.businessTask.api, release = delivery.release.api;
  return createClusterManagementModule({ ...(deps.settings.platformPodUid ? { deletion: { processes: projectCallbackOwners(deps.k8s, deps.settings.systemNamespace, deps.settings.platformPodUid, 'crewstation.io/cluster-project-stop'), identities: deps.identities, assertAvailable: (id: string) => core.project.api.assertProjectAvailable(id as ProjectId), assertGrant: core.project.api.assertProjectDeletionGrant } } : {}), metrics: deps.settings.clusterMetrics, resolveReleaseId: (legacy) => deps.identities.resolve('release', [legacy]), physicalOperationId: async (id) => (await deps.identities.aliases('cluster-operation', id)).find((keys) => keys.length === 1 && keys[0] !== id)?.[0] ?? id, db: deps.db, k8s: deps.k8s, instance: deps.instance, logger: deps.logger, systemNamespace: deps.settings.systemNamespace, catalog: installedSystemComponents().map((c) => c.kind === 'Namespace' ? { ...c, name: deps.settings.systemNamespace } : c), isAdmin: core.identity.api.isAdmin,
    authorizeProject: async (actor, projectId) => { await core.project.api.authorize(actor, projectId as ProjectId, 'develop'); },
    ledger: { claims: (actor, objects) => resources.api.claimsOf(actor, objects) },
    metadata: { read: () => clusterMetadata({ projects: core.project.api.listClusterProjects, tasks: tasks.listClusterTasks, slots: release.listClusterSlots, plans: core.project.api.listServicePlans }) },
    domains: clusterOperationPorts({ tasks, dev, business, release, stopProfile: core.agentRuntime.api.stopClusterTest }),
  });
}
