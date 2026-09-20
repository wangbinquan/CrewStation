import { BUILTIN_RESOURCES } from '@crewstation/contracts';
import { resourceIdentityDirectory, type ResourceIdentityDirectory } from '@crewstation/persistence';
import { createClusterManagementModule } from '@crewstation/module-cluster-management';
import { installedSystemComponents } from './domain/systemComponents';
import type { ClusterResource, ClusterInspectRequest, ClusterOperation, ClusterInspection, TaskId, ProfileTestId, RebuildDevSessionRequest } from '@crewstation/contracts';
import type { Actor, ComputeProfileSelector, ComputeUsage, ProjectId, ServiceId, UserDto, UserId } from '@crewstation/contracts';
import type { EventConsumer } from '@crewstation/eventbus';
import type { K8sClient } from '@crewstation/k8s';
import { buildEgressNetworkPolicy, namespaceObject, projectNetworkPolicy, resourceQuotaObject, secretObject, taskEgressNetworkPolicy } from '@crewstation/k8s';
import type { Logger } from '@crewstation/kernel';
import { forbidden, precondition } from '@crewstation/kernel';
import { createAgentRuntimeModule } from '@crewstation/module-agent-runtime';
import type { AgentRuntimeModuleApi } from '@crewstation/module-agent-runtime';
import { createApiCatalogModule } from '@crewstation/module-api-catalog';
import { createBusinessTaskModule } from '@crewstation/module-business-task';
import { createCapabilitiesModule } from '@crewstation/module-capabilities';
import { createConfigModule } from '@crewstation/module-config';
import { createDataModule } from '@crewstation/module-data';
import { createDevSessionModule } from '@crewstation/module-dev-session';
import { createEgressModule } from '@crewstation/module-egress';
import type { EventsModuleApi } from '@crewstation/module-events';
import { createEventsModule } from '@crewstation/module-events';
import { createGatewayModule } from '@crewstation/module-gateway';
import type { GatewayModuleApi } from '@crewstation/module-gateway';
import { createIdentityModule } from '@crewstation/module-identity';
import { createObservabilityModule } from '@crewstation/module-observability';
import { createProjectModule } from '@crewstation/module-project';
import { createProvisioningModule } from '@crewstation/module-provisioning';
import type { ProjectModuleApi } from '@crewstation/module-project';
import { createReleaseModule } from '@crewstation/module-release';
import type { ReleaseModuleApi } from '@crewstation/module-release';
import { createScmModule } from '@crewstation/module-scm';
import { createSessionModule } from '@crewstation/module-session';
import { createTaskRuntimeModule } from '@crewstation/module-task-runtime';
import type { TaskRuntimeModuleApi } from '@crewstation/module-task-runtime';
import type { Database } from '@crewstation/persistence';
import { eventbusMigrations } from '@crewstation/eventbus';
import { queueMigrations } from '@crewstation/queue';
import { createSessionClient } from '@crewstation/session-client';
import type { PlatformSettings } from '@crewstation/settings';
import type { AppEnv } from '@crewstation/http';
import type { MigrationSet } from '@crewstation/persistence';
import type { Hono } from 'hono';
import type { Lifecycle } from './api/moduleApi';

/** 组合根的对外形状：各进程只挑选自己角色的入口；模块实例也暴露出来供 CLI 与测试直接使用。 */
export interface PlatformModuleApi {
  readonly name: 'platform';
  /** 引导首位管理员这一条运维路径需要它：安装脚本在容器内以子命令调用（RFC-005 §8）。 */
  readonly initializePlatformRoles: () => Promise<{ initialized: number }>;
  readonly bootstrapAdmin: (raw: unknown) => Promise<UserDto>;
  readonly routers: { api: Hono<AppEnv>[]; auth: Hono<AppEnv>[]; session: Hono<AppEnv>[]; events: Hono<AppEnv>[] };
  readonly background: { controller: Lifecycle[]; session: Lifecycle[]; events: Lifecycle[] };
  readonly websocket: unknown;
  readonly migrations: MigrationSet[];
}

export interface PlatformModuleDeps {
  db: Database;
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

interface Late { events?: EventsModuleApi; project?: ProjectModuleApi; gateway?: GatewayModuleApi; taskRuntime?: TaskRuntimeModuleApi; release?: ReleaseModuleApi }

type CompositionDeps = PlatformModuleDeps & { identities: ResourceIdentityDirectory };

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
    previewAccess: { canView: async (userId, slug) => { const r = await projectApi().resolveServiceIdentity(`${slug}/${slug}`); return r ? (await projectApi().roleOf({ userId, isAdmin: await projectApi().isAdmin(userId) }, r.projectId)) !== undefined : false; } },
    membershipLookup: { membershipsOf: (userId) => projectApi().listUserMemberships(userId) },
    workloadLookup: { byIp: (ip) => gatewayApi().lookupByIp(ip) },
    allowlistEvaluator: { evaluate: (caller, target) => gatewayApi().evaluate(caller, target) },
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
  const egress = createEgressModule({ db, project: project.api });
  // 算力档位（RFC-006、ADR-0005）：测试执行在 task-runtime（L4）、已上线引用在 release（L4）、资源套餐在 project（L2），都由这里回填。
  const agentRuntime = createAgentRuntimeModule({
    db, logger, isAdmin: (id) => identity.api.isAdmin(id),
    projects: { authorize: project.api.authorize, name: async (projectId) => (await project.api.resolveServiceOfProject(projectId))?.slug },
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
    db, isAdmin: (id) => isAdmin(id), authorizer: project.api, users: userDirectory,
    services: { resolveServiceById: async (id) => { const r = await resolveById(id); return r ? { projectId: r.projectId, slug: r.slug } : undefined; } },
    settings: { defaultPlan: 'db-small', secretKeyBase64: settings.secretKeyBase64, postgres: settings.dataPostgres },
  });
  const scm = createScmModule({ db, project: project.api, identities: deps.identities, templateResources: {
    allocate: (kind, context, templateId, slotId) => deps.identities.bind('scm', kind, ['template', context.serviceId, templateId, slotId]),
    ensureDefinition: config.api.ensureTemplateDefinition,
    eventType: async (producerCode, eventCode) => {
      if (!late.events) throw new Error('events 尚未装配');
      return (await late.events.listEventTypes(SYSTEM_ACTOR)).find((entry) => entry.state === 'active' && entry.producer === producerCode && entry.eventType === eventCode)?.id;
    },
  }, settings: { baseUrl: settings.gitlab.baseUrl, groupPath: settings.gitlab.groupPath, platformToken: settings.gitlab.platformToken, platformBotName: settings.gitlab.botName, defaultBranch: 'main' } });
  const apiCatalog = createApiCatalogModule({
    db, projects: project.api, hosts, logger, users: userDirectory,
    onCatalogChanged: async (serviceId) => {
      await gatewayApi().reconcileService(serviceId);
      await gatewayApi().rebuildAllowlist();
    },
    services: {
      resolveService: async (id) => { const r = await resolveById(id); return r ? { projectId: r.projectId, serviceId: r.serviceId, slug: r.slug, identity: r.identity } : undefined; },
      resolveServiceIdentity: async (identity) => { const r = await project.api.resolveServiceIdentity(identity); return r ? { projectId: r.projectId, serviceId: r.serviceId, slug: r.slug, identity: r.identity } : undefined; },
    },
  });
  return { identity, project, config, egress, data, scm, apiCatalog, agentRuntime, hosts, isAdmin, resolveById };
}

function composeDelivery(deps: CompositionDeps, core: ReturnType<typeof composeCore>, late: Late) {
  const { db, k8s, settings, logger } = deps;
  const { project, config, data, scm, apiCatalog, hosts, isAdmin, resolveById } = core;
  const release = createReleaseModule({
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
    },
    plans: {
      getServicePlan: async (name) => (await project.api.listServicePlans()).find((p) => p.id === name),
      lookupComputeProfile: (name, projectId) => core.agentRuntime.api.lookupForProjectRelease(projectId, name),
      listComputeProfiles: () => core.agentRuntime.api.listNames(),
    },
    config: {
      render: async (projectId, env) => ({ values: await config.api.renderDefinitions(projectId, env), version: await config.api.currentVersion(projectId, env) }),
      validate: (projectId, env, keys) => config.api.validateManifestEnv(projectId, env, keys.map((configDefinitionId) => ({ name: 'CONFIG', configDefinitionId, from: 'config' as const }))),
    },
    data: { envFor: data.api.envFor },
    settings: { userDomain: settings.userDomain, serviceDomain: settings.serviceDomain, registryBase: settings.registryBase, maintenanceWindow: settings.maintenanceWindow, buildTimeoutSeconds: 1800, deployTimeoutSeconds: 600, builderImage: settings.builderImage, buildkitAddress: settings.buildkitAddress, workerOwner: `${deps.instance}.release` },
  });
  const listServices = async () => (await project.api.listServices()).map((s) => ({ serviceId: s.serviceId, projectId: s.projectId, projectSlug: s.slug, serviceName: s.name, namespace: s.namespace, identity: s.identity, kind: s.kind }));
  const gateway = createGatewayModule({
    identities: deps.identities,
    db, k8s, hosts, logger, isAdmin: (id) => isAdmin(id),
    services: { listServices, getService: async (id) => (await listServices()).find((s) => s.serviceId === id), serviceIdOfProject: async (projectId) => (await listServices()).find((s) => s.projectId === projectId)?.serviceId },
    slots: { slotRoles: release.api.slotRoles },
    grants: { grantedOperations: apiCatalog.api.grantedOperations, listCallers: async () => [], proxyNameOf: apiCatalog.api.activeProxyNameOf },
    settings: { systemNamespace: settings.systemNamespace, serviceDomain: settings.serviceDomain, userAuthMiddleware: 'forward-auth-user', serviceAuthMiddleware: 'forward-auth-service', dropIdentityHeadersMiddleware: 'drop-identity-headers', allowlistMaxStaleSeconds: 300, consumerName: 'gateway' },
  });
  late.gateway = gateway.api;
  late.release = release.api;
  return { release, gateway };
}

/**
 * 算力档位解析（RFC-006 §4.3）：一处实现，dev-session 与 business-task 共用。受理时固定档位修订；
 * 派发时按固定修订取材料（含解密凭据），只经受控 Runner 命令通道发出。
 */
function computeCatalogFor(agentRuntime: AgentRuntimeModuleApi) {
  return { resolve: (name: ComputeProfileSelector | undefined, usage: ComputeUsage, projectId: ProjectId) => agentRuntime.resolveForProject(projectId, name, usage), launchMaterial: agentRuntime.launchMaterial };
}

function composeRuntime(deps: CompositionDeps, core: ReturnType<typeof composeCore>, delivery: ReturnType<typeof composeDelivery>, late: Late) {
  const { db, k8s, settings, logger } = deps;
  const { project, config, data, scm, isAdmin, resolveById } = core;
  const { release } = delivery;
  const testRunner = createSessionClient(settings.sessionInternalUrl);
  const mcp = [{ name: 'capabilities', url: settings.mcp.capabilitiesUrl }, { name: 'operations', url: settings.mcp.operationsUrl }];
  const taskRuntime = createTaskRuntimeModule({
    db, k8s, logger, isAdmin: (id) => isAdmin(id), authorizer: project.api, quotas: { quotaLimit: project.api.quotaLimit }, testRunner, testMcp: mcp,
    profiles: { devSessionProfile: core.agentRuntime.api.projectDevTaskProfile, listTaskProfiles: project.api.listTaskProfiles, getTaskProfile: async (name) => (await project.api.listTaskProfiles()).find((p) => p.id === name) },
    services: { resolveServiceById: resolveById },
    checkout: {
      // 开发容器的工作卷要先有源码：签一个只读的会话级 Git 令牌，写进项目命名空间的 Secret，
      // 只挂给 checkout init 容器。推送由平台在发布时完成，长驻容器里不需要写权限。
      checkoutFor: async (serviceId) => {
        const [binding, svc, credential] = await Promise.all([core.scm.api.getBinding(SYSTEM_ACTOR, serviceId), resolveById(serviceId), core.scm.api.issueSessionCredential(serviceId, 30)]);
        if (!svc) return undefined;
        const name = `git-checkout-${serviceId.replaceAll('-', '')}`;
        await k8s.apply(secretObject({ name, namespace: svc.namespace, stringData: { token: credential.token }, labels: { 'crewstation.io/service': svc.name } }));
        return { repoUrl: binding.httpUrl, credentialSecretName: name };
      },
    },
    sources: { configEnv: (projectId, env) => config.api.renderEnv(projectId, env), dataEnv: data.api.envFor, taskDataEnv: data.api.envForTask },
    settings: { taskImage: settings.taskImage, systemNamespace: settings.systemNamespace, sessionUrl: settings.sessionRunnerUrl, userDomain: settings.userDomain, serviceDomain: settings.serviceDomain, workerUid: 10001, defaultProfile: settings.defaultTaskProfile, userAuthMiddleware: 'forward-auth-user', dropIdentityHeadersMiddleware: 'drop-identity-headers' },
  });
  late.taskRuntime = taskRuntime.api;
  const runner = createSessionClient(settings.sessionInternalUrl);
  const computeCatalog = computeCatalogFor(core.agentRuntime.api);
  const devSession = createDevSessionModule({
    identities: deps.identities,
    apiCatalog: core.apiCatalog.api,
    db, logger, isAdmin: (id) => isAdmin(id), environments: taskRuntime.api, runner, releases: release.api,
    scm: {
      listBranches: (serviceId, compare) => scm.api.listBranches(SYSTEM_ACTOR, serviceId, compare),
      pushUrl: async (serviceId) => { const c = await scm.api.issueSessionCredential(serviceId, 60); return { url: c.httpUrlWithCredentialTemplate.replace('{token}', encodeURIComponent(c.token)), expiresAt: c.expiresAt }; },
      readFile: scm.api.readFile,
    },
    authorizer: { authorize: project.api.authorize, ownerOf: project.api.ownerOf },
    services: { resolveServiceOfProject: project.api.resolveServiceOfProject },
    notifier: { notify: async (projectId, users, message, context) => { logger.warn('dev session notice', { projectId, users, message, taskId: context.taskId }); } },
    // 注入 Agent 的远程 MCP 连接凭据由 identity 签发：一个签发者、一个密钥环、一份 JWKS。
    credentials: { issueDevSessionToken: (binding) => core.identity.api.issueDevSessionToken(binding) },
    compute: computeCatalog,
    settings: { idleMinutes: settings.idleMinutes, userDomain: settings.userDomain, mcp, defaultPreviewPort: 3000 },
  });
  const businessTask = createBusinessTaskModule({
    identities: deps.identities,
    db, logger, isAdmin: (id) => isAdmin(id), environments: taskRuntime.api, runner, authorizer: project.api,
    directory: { resolveServiceIdentity: async (identity) => { const r = await project.api.resolveServiceIdentity(identity); return r ? { serviceId: r.serviceId, projectId: r.projectId } : undefined; } },
    compute: computeCatalog,
    settings: { mcp, outputLimitBytes: 262144, consumerName: 'business-task' },
  });
  const events = createEventsModule({
    db, logger, projects: project.api,
    services: { resolveService: async (id) => { const r = await resolveById(id); return r ? { projectId: r.projectId, serviceId: r.serviceId, slug: r.slug, identity: r.identity } : undefined; } },
    endpoints: { resolve: async (serviceId) => { const [ep, svc] = await Promise.all([release.api.activeEndpoint(serviceId), resolveById(serviceId)]); return ep && svc ? { baseUrl: `http://${svc.slug}.${settings.serviceDomain}` } : undefined; } },
    worker: { owner: `${deps.instance}.events`, concurrency: 4 },
  });
  const session = createSessionModule({
    identities: deps.identities,
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
  return { taskRuntime, devSession, businessTask, events, session, sessionClient: runner };
}

function composeAggregates(deps: PlatformModuleDeps, core: ReturnType<typeof composeCore>, delivery: ReturnType<typeof composeDelivery>, runtime: ReturnType<typeof composeRuntime>) {
  const { db, k8s, settings, logger } = deps;
  const { project, config, data, apiCatalog, isAdmin } = core;
  const serviceOfProject = project.api.resolveServiceOfProject;
  const observability = createObservabilityModule({
    db, k8s, logger, isAdmin: (id) => isAdmin(id), authorizer: project.api, services: { resolveServiceOfProject: serviceOfProject }, slots: delivery.release.api,
    traces: {
      tasksByTrace: async (traceId) => (await runtime.taskRuntime.api.listByTrace(traceId)).map((e) => ({ taskId: e.id, kind: e.kind, createdAt: e.createdAt })),
      subtasksOfTask: (taskId) => runtime.businessTask.api.listProjectSubtasksInternal(taskId),
      sessionEvents: (taskId) => runtime.sessionClient.listEvents(taskId, { kinds: ['agent', 'execExited', 'previewState'], limit: 2000 }),
    },
    notifier: { notify: async (projectId, message) => { logger.warn('alert', { projectId, message }); } },
    listProjectIds: async () => (await project.api.listServices()).map((s) => s.projectId),
  });
  const capabilities = createCapabilitiesModule({
    isAdmin: (id) => isAdmin(id),
    market: { list: project.api.listMarketListings, get: project.api.getMarketListing, slots: (serviceId) => delivery.release.api.getSlots(SYSTEM_ACTOR, serviceId) },
    projects: { list: project.api.listProjectPage, read: project.api.readProjectPageEntries, get: project.api.getProjectPageEntry,
      session: (projectId) => runtime.taskRuntime.api.findDevSession(projectId, { includeLatestFailure: true }), slots: delivery.release.api.getSlots, preview: delivery.release.api.getPreviewSlot, health: observability.api.health,
      releases: delivery.release.api.listReleases, switches: delivery.release.api.listTrafficSwitches },
    settings: { userDomain: settings.userDomain, serviceDomain: settings.serviceDomain, mcp: [{ name: 'capabilities', url: settings.mcp.capabilitiesUrl }, { name: 'operations', url: settings.mcp.operationsUrl }], defaultServicePlan: settings.defaultServicePlan },
    sources: {
      resolveServiceOfProject: serviceOfProject, authorize: project.api.authorize, quota: project.api.getQuota, servicePlans: project.api.listServicePlans,
      computeProfiles: core.agentRuntime.api.listProjectSummaries,
      configKeys: async (actor, projectId, env) => (await config.api.listItems(actor, projectId, env)).map((i) => i.name),
      dataResources: data.api.listResources, operations: (actor, serviceId) => apiCatalog.api.listOperations(actor, serviceId),
      subscriptions: (actor, projectId) => runtime.events.api.listSubscriptions(actor, projectId),
      identityForwarding: (projectId) => core.identity.api.effectiveForwarding(projectId),
    },
  });
  const provisioning = createProvisioningModule({
    db, logger, workerOwner: `${deps.instance}.provisioning`, consumerName: 'provisioning', isAdmin: (id) => isAdmin(id),
    authorizeRetry: async (actor, id) => {
      const role = await project.api.authorize(actor, id, 'view');
      if (role !== 'owner' && role !== 'admin') throw forbidden('只有负责人或管理员可以重新开通项目');
      if ((await project.api.getProject(actor, id)).state !== 'failed') throw precondition('只有开通失败的项目可以重试');
    },
    steps: {
      loadProject: project.api.getProvisioningProject,
      ensureNamespace: async (f) => {
        await k8s.apply(namespaceObject(f.namespace, { 'crewstation.io/project': f.slug }));
        await k8s.apply(resourceQuotaObject({ name: 'crewstation-project', namespace: f.namespace, hard: { pods: '30', 'requests.cpu': '8', 'requests.memory': '16Gi', persistentvolumeclaims: '20' } }));
        await k8s.apply(projectNetworkPolicy({ namespace: f.namespace, systemNamespace: settings.systemNamespace }));
        await k8s.apply(taskEgressNetworkPolicy({ namespace: f.namespace }));
        await k8s.apply(buildEgressNetworkPolicy({ namespace: f.namespace }));
      },
      ensureRepository: async (f) => { await core.scm.api.ensureRepository(f.serviceId, f.projectId, { slug: f.slug, templateId: f.template, ...(f.initialPlan === undefined ? {} : { initialPlan: f.initialPlan }) }); },
      ensureData: async (f) => { await data.api.ensureServiceData(f.serviceId); },
      reconcileRoutes: async (f) => { await delivery.gateway.api.reconcileService(f.serviceId); },
      ensureFirstRelease: async (f) => { if ((await delivery.release.api.listReleases(SYSTEM_ACTOR, f.serviceId)).length === 0) await delivery.release.api.publish(SYSTEM_ACTOR, f.serviceId, { branch: 'main', version: 'v0.1.0' }); },
      setProjectState: async (projectId, state, message) => { await project.api.setProjectState(projectId, state, message); },
    },
  });
  return { observability, capabilities, provisioning };
}

function composeModules(deps: CompositionDeps) {
  const late: Late = {};
  const core = composeCore(deps, late);
  const delivery = composeDelivery(deps, core, late);
  const runtime = composeRuntime(deps, core, delivery, late);
  const aggregates = composeAggregates(deps, core, delivery, runtime);
  const cluster = composeCluster(deps, core, delivery, runtime);
  return { cluster, identity: core.identity, project: core.project, config: core.config, egress: core.egress, data: core.data, scm: core.scm, apiCatalog: core.apiCatalog, agentRuntime: core.agentRuntime, ...delivery, ...runtime, ...aggregates };
}

export function createPlatformModule(deps: PlatformModuleDeps): PlatformModule {
  let migrations: MigrationSet[] = [];
  const identities = resourceIdentityDirectory(deps.db, () => migrations);
  const m = composeModules({ ...deps, identities });
  const api: PlatformModuleApi = {
    name: 'platform',
    initializePlatformRoles: () => m.identity.api.initializePlatformRoles(),
    bootstrapAdmin: (raw) => m.identity.api.bootstrapAdmin(raw),
    routers: {
      // devSessionGate 只挂中间件不占路径，必须排在最前：Hono 按注册顺序执行，晚于业务路由就来不及改判身份。
      api: [...m.identity.http.devSessionGate, ...m.project.http, ...m.identity.http.users, ...m.config.http, ...m.agentRuntime.http, ...m.egress.http, ...m.data.http, ...m.scm.http, ...m.apiCatalog.http, ...m.release.http, ...m.gateway.http, ...m.taskRuntime.http, ...m.devSession.http, m.businessTask.http.service, m.businessTask.http.user, ...m.events.http.query, ...m.observability.http, ...m.cluster.http, ...m.capabilities.http, ...m.provisioning.http],
      auth: [...m.identity.http.auth, ...m.identity.http.forwardAuth, ...m.agentRuntime.forwardAuth],
      session: [m.session.http.runner, m.session.http.stream, m.session.http.internal],
      events: [...m.events.http.ingress],
    },
    background: {
      controller: [...m.cluster.workers, ...m.release.workers, ...m.gateway.workers, consumerLifecycle(m.gateway.subscriptions), ...m.taskRuntime.workers, ...m.agentRuntime.workers, ...m.devSession.workers, ...m.businessTask.workers, consumerLifecycle(m.businessTask.subscriptions), ...m.apiCatalog.subscriptions.map(consumerLifecycle), ...m.observability.workers, ...m.provisioning.workers, consumerLifecycle(m.provisioning.subscriptions)],
      session: [...m.session.workers],
      events: [...m.events.workers, ...m.events.subscriptions.map(consumerLifecycle)],
    },
    websocket: m.session.websocket,
    migrations: [queueMigrations, eventbusMigrations, m.identity.migrations, m.project.migrations, m.config.migrations, m.agentRuntime.migrations, m.egress.migrations, m.data.migrations, m.scm.migrations, m.apiCatalog.migrations, m.events.migrations, m.release.migrations, m.taskRuntime.migrations, m.devSession.migrations, m.businessTask.migrations, m.session.migrations, m.gateway.migrations, m.observability.migrations, m.cluster.migrations],
  };
  migrations = api.migrations;
  return { api, modules: m };
}

function composeCluster(deps: CompositionDeps, core: ReturnType<typeof composeCore>, delivery: ReturnType<typeof composeDelivery>, runtime: ReturnType<typeof composeRuntime>) {
  const tasks = runtime.taskRuntime.api, dev = runtime.devSession.api, business = runtime.businessTask.api, release = delivery.release.api;
  const inspectTask = async (actor: Actor, target: ClusterResource, request: ClusterInspectRequest): Promise<Record<string, unknown>> => {
    if (target.purpose === 'development-cli') return dev.inspectClusterNative(actor, target.taskId as TaskId);
    if (target.purpose === 'development-agent') return dev.inspectClusterAgent(actor, target.taskId as TaskId);
    if (target.purpose === 'business-subtask' || target.purpose === 'business-workspace') return business.inspectClusterTask(actor, target, request);
    if (target.purpose === 'profile-test') { if (request.action !== 'delete') throw precondition('档位测试只能停止，请从算力档位页面重新测试'); if (!target.facts.profileTestId) throw precondition('任务记录缺少档位测试关联，请从算力档位页面核对'); return { testId: target.facts.profileTestId }; }
    const env = await tasks.getEnvironment(target.taskId as TaskId); if (!env) throw precondition('开发环境不存在');
    const { checkedAt: _checkedAt, ...workspace } = await dev.workspaceStatus(actor, env.projectId);
    if (request.action === 'delete') return { taskId: env.id, volumeMode: env.volumeMode, workspace };
    const inspection = await tasks.inspectRebuild(env.projectId, true), profile = inspection.profiles.find((p) => p.id === inspection.currentProfile);
    if (!profile) throw precondition('原任务套餐已不存在');
    return { taskId: env.id, workspace, rebuild: { expectedTaskId: env.id, expectedUpdatedAt: inspection.updatedAt, expectedPodUid: inspection.podUid, expectedVolumeUid: inspection.volume.uid, profile: { id: profile.id, name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage }, reason: inspection.reason } };
  };
  const executeTask = async (actor: Actor, op: ClusterOperation, inspection: ClusterInspection) => {
    if (op.target.purpose === 'development-cli') return dev.manageClusterNative(actor, op.target.taskId as TaskId, op.action === 'restart', op.operationId);
    if (op.target.purpose === 'development-agent') return dev.manageClusterAgent(actor, op.target.taskId as TaskId, op.action === 'restart', op.operationId);
    if (op.target.purpose === 'business-subtask' || op.target.purpose === 'business-workspace') return business.executeClusterTask(actor, op);
    if (op.target.purpose === 'profile-test') { await core.agentRuntime.api.stopClusterTest(actor, inspection.domain?.testId as ProfileTestId); await tasks.releaseEnvironment(op.target.taskId as TaskId, 'profile-test'); return { operationId: op.target.taskId! }; }
    const env = await tasks.getEnvironment(op.target.taskId as TaskId); if (!env) throw precondition('开发环境不存在');
    if (op.action === 'delete') await dev.releaseSession(actor, env.projectId, { force: true, expectedTaskId: env.id });
    else await dev.rebuildSession(actor, env.projectId, { ...inspection.domain?.rebuild as Omit<RebuildDevSessionRequest, 'requestId'>, requestId: op.operationId });
    return { operationId: op.action === 'restart' ? op.operationId : env.id };
  };
  const observeTask = async (op: ClusterOperation) => {
    if (op.target.purpose === 'business-subtask' || op.target.purpose === 'business-workspace') return business.observeClusterTask(op);
    if (op.action === 'restart' && op.target.purpose === 'development-workspace') { const rebuild = await tasks.getRebuild(op.target.taskId as TaskId); return { done: rebuild?.state === 'ready' || rebuild?.state === 'failed', failed: rebuild?.state === 'failed', reason: rebuild?.message ?? '等待新工作区 Runner 连接' }; }
    const env = await tasks.getEnvironment((op.action === 'restart' ? op.domainOperationId : op.target.taskId) as TaskId);
    return { done: op.action === 'delete' ? !env || env.state === 'released' : env?.state === 'running' && env.connected || env?.state === 'failed', failed: op.action === 'restart' && env?.state === 'failed', reason: env?.message ?? (op.action === 'delete' ? '等待执行环境回收' : '等待新执行连接') };
  };
  return createClusterManagementModule({ resolveReleaseId: (legacy) => deps.identities.resolve('release', [legacy]), physicalOperationId: async (id) => (await deps.identities.aliases('cluster-operation', id)).find((keys) => keys.length === 1 && keys[0] !== id)?.[0] ?? id, db: deps.db, k8s: deps.k8s, instance: deps.instance, logger: deps.logger, systemNamespace: deps.settings.systemNamespace, catalog: installedSystemComponents().map((c) => c.kind === 'Namespace' ? { ...c, name: deps.settings.systemNamespace } : c), isAdmin: core.identity.api.isAdmin,
    metadata: { read: async () => {
      const [projects, taskFacts, slots, plans] = await Promise.all([core.project.api.listClusterProjects(), tasks.listClusterTasks(), release.listClusterSlots(), core.project.api.listServicePlans()]);
      const releases = slots.flatMap((slot) => { const project = projects.find((p) => p.serviceId === slot.serviceId); return project ? [{ ...slot, namespace: project.namespace, serviceName: project.serviceName!, ...(slot.plan ? { maxReplicas: plans.find((p) => p.id === slot.plan)?.maxReplicas ?? 0 } : {}) }] : []; });
      const retained = projects.filter((p) => p.serviceName).flatMap((p) => ['blue', 'green'].map((slot) => ({ namespace: p.namespace, kind: 'Service', name: `${p.serviceName}-${slot}`, reason: '发布槽 Service 跨发布保留' })));
      for (const p of projects) { retained.push({ namespace: p.namespace, kind: 'ResourceQuota', name: 'crewstation-project', reason: '项目配额' }); for (const name of ['crewstation-default', 'crewstation-task-egress', 'crewstation-build-egress']) retained.push({ namespace: p.namespace, kind: 'NetworkPolicy', name, reason: '项目网络配置' }); }
      return { projects, tasks: taskFacts, releases, retained, complete: true };
    } },
    domains: { inspect: async (actor, target, request) => {
      if (target.serviceId && target.kind === 'Deployment') return release.inspectSlotOperation(actor, target, request);
      const capability = target.availableActions.find((a) => a.action === request.action)!;
      try { const domain = await inspectTask(actor, target, request); return { capability: { ...capability, impactSummary: [...capability.impactSummary, ...(domain.volumeMode === 'follow-container' && request.action === 'delete' ? ['此工作区的工作卷也会释放，请先确认所有未提交及未推送内容'] : []), ...(target.purpose === 'development-workspace' && request.action === 'restart' ? ['保留原任务与工作卷；结束该工作区内所有 CLI 和 Agent，新工作区连接后需手动启动'] : [])] }, domain }; } catch (e) { return { capability: { ...capability, enabled: false, reason: e instanceof Error ? e.message : String(e) } }; }
    }, execute: (actor, op, inspection) => op.target.kind === 'Deployment' ? release.executeSlotOperation(actor, op, inspection) : executeTask(actor, op, inspection), observe: (op) => op.target.kind === 'Deployment' ? release.observeSlotOperation(op) : observeTask(op) },
  });
}
