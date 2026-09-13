import type { Actor, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import type { EventConsumer } from '@crewstation/eventbus';
import type { K8sClient } from '@crewstation/k8s';
import { buildEgressNetworkPolicy, namespaceObject, projectNetworkPolicy, resourceQuotaObject, secretObject, taskEgressNetworkPolicy } from '@crewstation/k8s';
import type { Logger } from '@crewstation/kernel';
import { createApiCatalogModule } from '@crewstation/module-api-catalog';
import { createBusinessTaskModule } from '@crewstation/module-business-task';
import { createCapabilitiesModule } from '@crewstation/module-capabilities';
import { createConfigModule } from '@crewstation/module-config';
import { createDataModule } from '@crewstation/module-data';
import { createDevSessionModule } from '@crewstation/module-dev-session';
import { createEgressModule } from '@crewstation/module-egress';
import { createEventsModule } from '@crewstation/module-events';
import { createGatewayModule } from '@crewstation/module-gateway';
import type { GatewayModuleApi } from '@crewstation/module-gateway';
import { createIdentityModule, demoIdentityProvider } from '@crewstation/module-identity';
import { createObservabilityModule } from '@crewstation/module-observability';
import { createProjectModule } from '@crewstation/module-project';
import { createProvisioningModule } from '@crewstation/module-provisioning';
import type { ProjectModuleApi } from '@crewstation/module-project';
import { createReleaseModule } from '@crewstation/module-release';
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
export const SYSTEM_ACTOR: Actor = { userId: 'usr_00000000000000000000000000000000' as UserId, isAdmin: true };

const consumerLifecycle = (consumer: EventConsumer): Lifecycle => ({ start: () => consumer.start(), stop: () => consumer.stop() });

interface Late { project?: ProjectModuleApi; gateway?: GatewayModuleApi; taskRuntime?: TaskRuntimeModuleApi }

function composeCore(deps: PlatformModuleDeps, late: Late) {
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
    db, logger,
    settings: { adminEmails: settings.adminEmails, userDomain: settings.userDomain, cookieDomain: `.${settings.userDomain}`, secure: settings.publicScheme === 'https', sessionTtlSeconds: settings.sessionTtlSeconds },
    provider: demoIdentityProvider(),
    previewAccess: { canView: async (userId, slug) => { const r = await projectApi().resolveServiceIdentity(`${slug}/${slug}`); return r ? (await projectApi().roleOf({ userId, isAdmin: await projectApi().isAdmin(userId) }, r.projectId)) !== undefined : false; } },
    membershipLookup: { membershipsOf: async (userId) => { const actor: Actor = { userId, isAdmin: false }; const out: Array<{ projectId: ProjectId; role: 'owner' | 'developer' | 'tester' }> = []; for (const p of await projectApi().listProjects(actor)) { const role = await projectApi().roleOf(actor, p.id); if (role && role !== 'admin') out.push({ projectId: p.id, role }); } return out; } },
    workloadLookup: { byIp: (ip) => gatewayApi().lookupByIp(ip) },
    allowlistEvaluator: { evaluate: (caller, target) => gatewayApi().evaluate(caller, target) },
    // 开发会话令牌的即时吊销点：每次校验现查环境，释放（releasing／released）即查不到，令牌当场失效。
    // 与 runningTasks 同理，task-runtime 装配前返回 undefined，也就是一律拒绝。
    devSessionState: { activeSession: async (taskId) => {
      const env = await late.taskRuntime?.getEnvironment(taskId);
      return env && env.kind === 'dev-session' && (env.state === 'creating' || env.state === 'running') ? { projectId: env.projectId } : undefined;
    } },
  });
  const project = createProjectModule({ db, identity: identity.api, hosts, taskUsage: { runningTasks }, settings: { defaultMaxConcurrentTasks: settings.defaultMaxConcurrentTasks, defaultServicePlan: settings.defaultServicePlan } });
  late.project = project.api;
  const isAdmin = (userId: string) => identity.api.isAdmin(userId as UserId);
  const resolveById = (serviceId: ServiceId) => project.api.resolveServiceById(serviceId);

  const config = createConfigModule({ db, project: project.api, settings: { secretKeyBase64: settings.secretKeyBase64 } });
  const egress = createEgressModule({ db, project: project.api });
  const data = createDataModule({
    db, isAdmin: (id) => isAdmin(id), authorizer: project.api,
    services: { resolveServiceById: async (id) => { const r = await resolveById(id); return r ? { projectId: r.projectId, slug: r.slug } : undefined; } },
    settings: { defaultPlan: 'db-small', secretKeyBase64: settings.secretKeyBase64, postgres: settings.dataPostgres },
  });
  const scm = createScmModule({ db, project: project.api, settings: { baseUrl: settings.gitlab.baseUrl, groupPath: settings.gitlab.groupPath, platformToken: settings.gitlab.platformToken, platformBotName: settings.gitlab.botName, defaultBranch: 'main' } });
  const apiCatalog = createApiCatalogModule({
    db, projects: project.api, hosts, logger,
    services: {
      resolveService: async (id) => { const r = await resolveById(id); return r ? { projectId: r.projectId, serviceId: r.serviceId, slug: r.slug, identity: r.identity } : undefined; },
      resolveServiceIdentity: async (identity) => { const r = await project.api.resolveServiceIdentity(identity); return r ? { projectId: r.projectId, serviceId: r.serviceId, slug: r.slug, identity: r.identity } : undefined; },
    },
  });
  return { identity, project, config, egress, data, scm, apiCatalog, hosts, isAdmin, resolveById };
}

function composeDelivery(deps: PlatformModuleDeps, core: ReturnType<typeof composeCore>, late: Late) {
  const { db, k8s, settings, logger } = deps;
  const { project, config, data, scm, apiCatalog, hosts, isAdmin, resolveById } = core;
  const release = createReleaseModule({
    db, k8s, hosts, logger, isAdmin: (id) => isAdmin(id), authorizer: project.api, services: { resolveServiceById: resolveById },
    tagger: { createReleaseTag: (serviceId, { branch, version, expectedCommitSha }) => scm.api.createReleaseTag(serviceId, { branch, ...(expectedCommitSha ? { expectedCommitSha } : {}), ...(version.startsWith('v') ? { tag: version } : { bump: version as 'major' | 'minor' | 'patch' }) }) },
    repo: {
      readFile: scm.api.readFile,
      repositoryUrl: async (serviceId) => {
        const [binding, svc, credential] = await Promise.all([scm.api.getBinding(SYSTEM_ACTOR, serviceId), resolveById(serviceId), scm.api.issueSessionCredential(serviceId, 180)]);
        if (!svc) throw new Error(`服务 ${serviceId} 不存在`);
        const name = `git-cred-${serviceId.slice(-12)}`;
        await k8s.apply(secretObject({ name, namespace: svc.namespace, stringData: { token: credential.token }, labels: { 'crewstation.io/service': svc.name } }));
        return { httpUrl: binding.httpUrl, credentialSecretName: name };
      },
    },
    plans: {
      getServicePlan: async (name) => (await project.api.listServicePlans()).find((p) => p.name === name),
      getComputeProfile: (name) => project.api.resolveComputeProfile(name),
      listComputeProfiles: () => project.api.listComputeProfiles(),
    },
    config: {
      render: async (projectId, env) => ({ values: await config.api.renderEnv(projectId, env), version: await config.api.currentVersion(projectId, env) }),
      validate: (projectId, env, keys) => config.api.validateManifestEnv(projectId, env, keys.map((name) => ({ name, from: 'config' as const }))),
    },
    data: { envFor: data.api.envFor },
    settings: { userDomain: settings.userDomain, serviceDomain: settings.serviceDomain, registryBase: settings.registryBase, maintenanceWindow: settings.maintenanceWindow, buildTimeoutSeconds: 1800, deployTimeoutSeconds: 600, builderImage: settings.builderImage, buildkitAddress: settings.buildkitAddress, workerOwner: `${deps.instance}.release` },
  });
  const listServices = async () => (await project.api.listServices()).map((s) => ({ serviceId: s.serviceId, projectId: s.projectId, projectSlug: s.slug, serviceName: s.name, namespace: s.namespace, identity: s.identity, kind: s.kind }));
  const gateway = createGatewayModule({
    db, k8s, hosts, logger, isAdmin: (id) => isAdmin(id),
    services: { listServices, getService: async (id) => (await listServices()).find((s) => s.serviceId === id), serviceIdOfProject: async (projectId) => (await listServices()).find((s) => s.projectId === projectId)?.serviceId },
    slots: { slotRoles: release.api.slotRoles },
    grants: { grantedOperations: apiCatalog.api.grantedOperations, listCallers: async () => [], proxyNameOf: async (serviceId) => (await apiCatalog.api.listProxies(SYSTEM_ACTOR)).find((p) => p.serviceId === serviceId)?.proxy },
    settings: { systemNamespace: settings.systemNamespace, serviceDomain: settings.serviceDomain, userAuthMiddleware: 'forward-auth-user', serviceAuthMiddleware: 'forward-auth-service', dropIdentityHeadersMiddleware: 'drop-identity-headers', allowlistMaxStaleSeconds: 300, consumerName: 'gateway' },
  });
  late.gateway = gateway.api;
  return { release, gateway };
}

function composeRuntime(deps: PlatformModuleDeps, core: ReturnType<typeof composeCore>, delivery: ReturnType<typeof composeDelivery>, late: Late) {
  const { db, k8s, settings, logger } = deps;
  const { project, config, data, scm, isAdmin, resolveById } = core;
  const { release } = delivery;
  const taskRuntime = createTaskRuntimeModule({
    db, k8s, logger, isAdmin: (id) => isAdmin(id), authorizer: project.api, quotas: { quotaLimit: project.api.quotaLimit },
    profiles: { getTaskProfile: async (name) => (await project.api.listTaskProfiles()).find((p) => p.name === name) },
    services: { resolveServiceById: resolveById },
    checkout: {
      // 开发容器的工作卷要先有源码：签一个只读的会话级 Git 令牌，写进项目命名空间的 Secret，
      // 只挂给 checkout init 容器。推送由平台在发布时完成，长驻容器里不需要写权限。
      checkoutFor: async (serviceId) => {
        const [binding, svc, credential] = await Promise.all([core.scm.api.getBinding(SYSTEM_ACTOR, serviceId), resolveById(serviceId), core.scm.api.issueSessionCredential(serviceId, 30)]);
        if (!svc) return undefined;
        const name = `git-checkout-${serviceId.slice(-12)}`;
        await k8s.apply(secretObject({ name, namespace: svc.namespace, stringData: { token: credential.token }, labels: { 'crewstation.io/service': svc.name } }));
        return { repoUrl: binding.httpUrl, credentialSecretName: name };
      },
    },
    sources: { configEnv: (projectId, env) => config.api.renderEnv(projectId, env), dataEnv: data.api.envFor, taskDataEnv: data.api.envForTask },
    settings: { taskImage: settings.taskImage, systemNamespace: settings.systemNamespace, sessionUrl: settings.sessionRunnerUrl, userDomain: settings.userDomain, serviceDomain: settings.serviceDomain, workerUid: 10001, defaultProfile: settings.defaultTaskProfile, userAuthMiddleware: 'forward-auth-user', dropIdentityHeadersMiddleware: 'drop-identity-headers', ...(settings.agentEnvSecretName ? { agentEnvSecretName: settings.agentEnvSecretName } : {}) },
  });
  late.taskRuntime = taskRuntime.api;
  const runner = createSessionClient(settings.sessionInternalUrl);
  // 算力档位解析（RFC-001）：一处实现，dev-session 与 business-task 共用。
  const computeCatalog = {
    resolve: (name: string) => project.api.resolveComputeProfile(name),
    list: () => project.api.listComputeProfiles(),
  };
  const mcp = [{ name: 'capabilities', url: settings.mcp.capabilitiesUrl }, { name: 'operations', url: settings.mcp.operationsUrl }];
  const devSession = createDevSessionModule({
    apiCatalog: core.apiCatalog.api,
    db, logger, isAdmin: (id) => isAdmin(id), environments: taskRuntime.api, runner, releases: release.api,
    scm: {
      listBranches: (serviceId, compare) => scm.api.listBranches(SYSTEM_ACTOR, serviceId, compare),
      pushUrl: async (serviceId) => { const c = await scm.api.issueSessionCredential(serviceId, 60); return { url: c.httpUrlWithCredentialTemplate.replace('{token}', encodeURIComponent(c.token)), expiresAt: c.expiresAt }; },
      readFile: scm.api.readFile,
    },
    authorizer: { authorize: project.api.authorize, ownerOf: project.api.ownerOf },
    services: { resolveServiceOfProject: async (projectId) => { const s = (await project.api.listServices()).find((x) => x.projectId === projectId); return s ? { serviceId: s.serviceId, slug: s.slug, name: s.name } : undefined; } },
    notifier: { notify: async (projectId, users, message, context) => { logger.warn('dev session notice', { projectId, users, message, taskId: context.taskId }); } },
    // 注入 Agent 的远程 MCP 连接凭据由 identity 签发：一个签发者、一个密钥环、一份 JWKS。
    credentials: { issueDevSessionToken: (binding) => core.identity.api.issueDevSessionToken(binding) },
    compute: computeCatalog,
    settings: { idleMinutes: settings.idleMinutes, userDomain: settings.userDomain, mcp, defaultPreviewPort: 3000, defaultComputeProfile: settings.defaultComputeProfile },
  });
  const businessTask = createBusinessTaskModule({
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
    db, logger, isAdmin: (id) => isAdmin(id),
    runnerAuth: { verifyRunnerToken: taskRuntime.api.verifyRunnerToken },
    taskAccess: {
      canOpenStream: taskRuntime.api.canOpenStream,
      // 先把环境标成已连接，再派发等容器就绪的业务子任务：提交子任务时容器往往还没连上。
      // 派发不能 await：这个回调跑在 cs-session 处理 hello 的串行链上，而派发要等 TaskRunner
      // 的回执——回执要经同一条链回来，等下去必然自锁到命令超时。
      onRunnerConnected: async (taskId) => {
        await taskRuntime.api.onRunnerConnected(taskId);
        void businessTask.api.dispatchPendingSubtasks(taskId)
          .then((dispatched) => { if (dispatched > 0) logger.info('dispatched pending subtasks', { taskId, dispatched }); })
          .catch((error: unknown) => logger.error('dispatch pending subtasks failed', { taskId, error: error instanceof Error ? error.message : String(error) }));
      },
      onRunnerDisconnected: taskRuntime.api.onRunnerDisconnected,
    },
    settings: { selfAddress: settings.selfAddress, commandTimeoutMs: 30_000, runnerStaleMs: 30_000, replayLimit: 2000 },
  });
  return { taskRuntime, devSession, businessTask, events, session, sessionClient: runner };
}

function composeAggregates(deps: PlatformModuleDeps, core: ReturnType<typeof composeCore>, delivery: ReturnType<typeof composeDelivery>, runtime: ReturnType<typeof composeRuntime>) {
  const { db, k8s, settings, logger } = deps;
  const { project, config, data, apiCatalog, isAdmin } = core;
  const serviceOfProject = async (projectId: ProjectId) => { const s = (await project.api.listServices()).find((x) => x.projectId === projectId); return s ? { serviceId: s.serviceId, slug: s.slug, name: s.name, identity: s.identity, namespace: s.namespace } : undefined; };
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
    settings: { userDomain: settings.userDomain, serviceDomain: settings.serviceDomain, mcp: [{ name: 'capabilities', url: settings.mcp.capabilitiesUrl }, { name: 'operations', url: settings.mcp.operationsUrl }], defaultServicePlan: settings.defaultServicePlan },
    sources: {
      resolveServiceOfProject: serviceOfProject, authorize: project.api.authorize, quota: project.api.getQuota, servicePlans: project.api.listServicePlans,
      computeProfiles: project.api.listComputeProfiles,
      configKeys: async (actor, projectId, env) => (await config.api.listItems(actor, projectId, env)).map((i) => i.name),
      dataResources: data.api.listResources, operations: (actor, serviceId) => apiCatalog.api.listOperations(actor, serviceId),
      subscriptions: (actor, projectId) => runtime.events.api.listSubscriptions(actor, projectId),
    },
  });
  const provisioning = createProvisioningModule({
    db, logger, workerOwner: `${deps.instance}.provisioning`, consumerName: 'provisioning', isAdmin: (id) => isAdmin(id),
    steps: {
      loadProject: project.api.getProvisioningProject,
      ensureNamespace: async (f) => {
        await k8s.apply(namespaceObject(f.namespace, { 'crewstation.io/project': f.slug }));
        await k8s.apply(resourceQuotaObject({ name: 'crewstation-project', namespace: f.namespace, hard: { pods: '30', 'requests.cpu': '8', 'requests.memory': '16Gi', persistentvolumeclaims: '20' } }));
        await k8s.apply(projectNetworkPolicy({ namespace: f.namespace, systemNamespace: settings.systemNamespace }));
        await k8s.apply(taskEgressNetworkPolicy({ namespace: f.namespace }));
        await k8s.apply(buildEgressNetworkPolicy({ namespace: f.namespace }));
      },
      ensureRepository: async (f) => { await core.scm.api.ensureRepository(f.serviceId, f.projectId, { slug: f.slug, templateName: f.template, ...(f.initialPlan === undefined ? {} : { initialPlan: f.initialPlan }) }); },
      ensureData: async (f) => { await data.api.ensureServiceData(f.serviceId); },
      reconcileRoutes: async (f) => { await delivery.gateway.api.reconcileService(f.serviceId); },
      ensureFirstRelease: async (f) => { if ((await delivery.release.api.listReleases(SYSTEM_ACTOR, f.serviceId)).length === 0) await delivery.release.api.publish(SYSTEM_ACTOR, f.serviceId, { branch: 'main', version: 'v0.1.0' }); },
      setProjectState: async (projectId, state, message) => { await project.api.setProjectState(projectId, state, message); },
    },
  });
  return { observability, capabilities, provisioning };
}

function composeModules(deps: PlatformModuleDeps) {
  const late: Late = {};
  const core = composeCore(deps, late);
  const delivery = composeDelivery(deps, core, late);
  const runtime = composeRuntime(deps, core, delivery, late);
  const aggregates = composeAggregates(deps, core, delivery, runtime);
  return { identity: core.identity, project: core.project, config: core.config, egress: core.egress, data: core.data, scm: core.scm, apiCatalog: core.apiCatalog, ...delivery, ...runtime, ...aggregates };
}

export function createPlatformModule(deps: PlatformModuleDeps): PlatformModule {
  const m = composeModules(deps);
  const api: PlatformModuleApi = {
    name: 'platform',
    routers: {
      // devSessionGate 只挂中间件不占路径，必须排在最前：Hono 按注册顺序执行，晚于业务路由就来不及改判身份。
      api: [...m.identity.http.devSessionGate, ...m.project.http, ...m.identity.http.users, ...m.config.http, ...m.egress.http, ...m.data.http, ...m.scm.http, ...m.apiCatalog.http, ...m.release.http, ...m.gateway.http, ...m.taskRuntime.http, ...m.devSession.http, m.businessTask.http.service, m.businessTask.http.user, ...m.events.http.query, ...m.observability.http, ...m.capabilities.http, ...m.provisioning.http],
      auth: [...m.identity.http.auth, ...m.identity.http.forwardAuth],
      session: [m.session.http.runner, m.session.http.stream, m.session.http.internal],
      events: [...m.events.http.ingress],
    },
    background: {
      controller: [...m.release.workers, ...m.gateway.workers, consumerLifecycle(m.gateway.subscriptions), ...m.taskRuntime.workers, ...m.devSession.workers, ...m.businessTask.workers, consumerLifecycle(m.businessTask.subscriptions), ...m.apiCatalog.subscriptions.map(consumerLifecycle), ...m.observability.workers, ...m.provisioning.workers, consumerLifecycle(m.provisioning.subscriptions)],
      session: [...m.session.workers],
      events: [...m.events.workers, ...m.events.subscriptions.map(consumerLifecycle)],
    },
    websocket: m.session.websocket,
    migrations: [queueMigrations, eventbusMigrations, m.identity.migrations, m.project.migrations, m.config.migrations, m.egress.migrations, m.data.migrations, m.scm.migrations, m.apiCatalog.migrations, m.events.migrations, m.release.migrations, m.taskRuntime.migrations, m.devSession.migrations, m.businessTask.migrations, m.session.migrations, m.gateway.migrations, m.observability.migrations],
  };
  return { api, modules: m };
}
