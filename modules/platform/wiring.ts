import { BUILTIN_RESOURCES } from '@crewstation/contracts';
import { resourceIdentityDirectory, type ResourceIdentityDirectory } from '@crewstation/persistence';
import { createClusterManagementModule } from '@crewstation/module-cluster-management';
import { createClusterControlModule } from '@crewstation/module-cluster-control';
import { createResourcesModule } from '@crewstation/module-resources';
import type { ResourcesModuleApi } from '@crewstation/module-resources';
import { installedSystemComponents } from './domain/systemComponents';
import type { ClusterResource, ClusterInspectRequest, ClusterOperation, ClusterInspection, TaskId, ProfileTestId, RebuildDevSessionRequest } from '@crewstation/contracts';
import type { Actor, ComputeProfileSelector, ComputeUsage, ProjectId, ServiceId, UserDto, UserId } from '@crewstation/contracts';
import type { EventConsumer } from '@crewstation/eventbus';
import type { K8sClient } from '@crewstation/k8s';
import { secretObject } from '@crewstation/k8s';
import type { Logger } from '@crewstation/kernel';
import { forbidden, precondition } from '@crewstation/kernel';
import { createAgentRuntimeModule } from '@crewstation/module-agent-runtime';
import type { AgentRuntimeModuleApi } from '@crewstation/module-agent-runtime';
import { createApiCatalogModule } from '@crewstation/module-api-catalog';
import { createBusinessTaskModule } from '@crewstation/module-business-task';
import { createCapabilitiesModule } from '@crewstation/module-capabilities';
import { createConfigModule } from '@crewstation/module-config';
import { createDataModule } from '@crewstation/module-data';
import { createDataControlModule } from '@crewstation/module-data-control';
import { createDevSessionModule } from '@crewstation/module-dev-session';
import type { EventsModuleApi } from '@crewstation/module-events';
import { createEventsModule } from '@crewstation/module-events';
import { createGatewayModule } from '@crewstation/module-gateway';
import type { GatewayModuleApi } from '@crewstation/module-gateway';
import { createIdentityModule } from '@crewstation/module-identity';
import { createObservabilityModule } from '@crewstation/module-observability';
import { createProjectModule } from '@crewstation/module-project';
import { createProvisioningModule } from '@crewstation/module-provisioning';
import type { ProjectFacts } from '@crewstation/module-provisioning';
import type { ProjectModuleApi, ResolvedService } from '@crewstation/module-project';
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
  readonly routers: { controller: Hono<AppEnv>[]; api: Hono<AppEnv>[]; auth: Hono<AppEnv>[]; session: Hono<AppEnv>[]; events: Hono<AppEnv>[] };
  readonly background: { controller: Lifecycle[]; api: Lifecycle[]; session: Lifecycle[]; events: Lifecycle[] };
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

interface Late { events?: EventsModuleApi; project?: ProjectModuleApi; gateway?: GatewayModuleApi; taskRuntime?: TaskRuntimeModuleApi; release?: ReleaseModuleApi; resources?: ResourcesModuleApi }

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
    // RFC-021：prod 主机的维护放行与 preview 主机的未部署页，判定在 gateway（L5），此处只接线。
    serviceEntry: { check: (userId, slug, slot) => gatewayApi().userEntry(userId, slug, slot) },
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
  // 台账（L1）装在 core 之后（它要 project 的额度与授权），data 在这里就要建：写入口经 late 在运行时取（RFC-025 第四期）。
  const ledger = () => { if (!late.resources) throw new Error('resources 尚未装配'); return late.resources; };
  const data = createDataModule({
    db, logger, isAdmin: (id) => isAdmin(id), authorizer: project.api, users: userDirectory,
    services: { resolveServiceById: async (id) => { const r = await resolveById(id); return r ? { projectId: r.projectId, slug: r.slug } : undefined; } },
    settings: { defaultPlan: 'db-small', secretKeyBase64: settings.secretKeyBase64, postgres: settings.dataPostgres },
    ledger: {
      declare: (input) => ledger().owner('data').declare(input), get: (id) => ledger().get(id), requestRelease: (id, reason) => ledger().owner('data').requestRelease(id, reason),
      presentBindings: async () => (await ledger().list({ kind: 'data-binding' })).filter((record) => record.owner.module === 'data' && record.desired === 'present'),
    },
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
  return { identity, project, config, data, scm, apiCatalog, agentRuntime, hosts, isAdmin, resolveById };
}

function composeDelivery(deps: CompositionDeps, core: ReturnType<typeof composeCore>, late: Late, resources: ReturnType<typeof composeLedger>) {
  const { db, k8s, settings, logger } = deps;
  const { project, config, data, scm, apiCatalog, hosts, isAdmin, resolveById } = core;
  const release = createReleaseModule({
    // 服务槽投影进资源台账（RFC-025 第三期）：在 release 自己的事务里写期望与领域条件。
    ledger: { within: (tx) => resources.api.owner('release').within(tx as object) },
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
      getServicePlan: async (name, projectId) => projectId ? project.api.resolveProjectServicePlan(projectId, name) : (await project.api.listServicePlans()).find((p) => p.id === name),
      lookupComputeProfile: (name, projectId) => core.agentRuntime.api.lookupForProjectRelease(projectId, name),
      listComputeProfiles: () => core.agentRuntime.api.listNames(),
    },
    config: {
      render: async (projectId, env) => ({ values: await config.api.renderDefinitions(projectId, env), version: await config.api.currentVersion(projectId, env) }),
      validate: (projectId, env, keys) => config.api.validateManifestEnv(projectId, env, keys.map((configDefinitionId) => ({ name: 'CONFIG', configDefinitionId, from: 'config' as const }))),
    },
    data: { envFor: data.api.envFor },
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
    // RFC-025 第三期后半：服务的路由投影成 route 记录（IngressRoute 仍由 gateway 建删）。
    ledger: resources.api.owner('gateway'),
    services: {
      listServices,
      getService: async (id) => { const s = await resolveById(id); return s ? directoryService(s) : undefined; },
      serviceIdOfProject: async (projectId) => (await project.api.resolveServiceOfProject(projectId))?.serviceId,
    },
    slots: { slotRoles: release.api.slotRoles, standbyEntry: release.api.standbyEntry, notePreviewAccess: release.api.notePreviewAccess },
    grants: { grantedOperations: apiCatalog.api.grantedOperations, listCallers: async () => [], proxyNameOf: apiCatalog.api.activeProxyNameOf },
    access: {
      authorize: project.api.authorize,
      isMemberOrAdmin: async (userId, projectId) => (await project.api.roleOf({ userId, isAdmin: await project.api.isAdmin(userId) }, projectId)) !== undefined,
    },
    users: { describe: async (userId) => { const user = await core.identity.api.getUser(userId); return user ? { name: user.name, email: user.email } : undefined; } },
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

function composeRuntime(deps: CompositionDeps, core: ReturnType<typeof composeCore>, delivery: ReturnType<typeof composeDelivery>, late: Late, resources: ReturnType<typeof composeLedger>) {
  const { db, k8s, settings, logger } = deps;
  const { project, config, data, scm, isAdmin, resolveById } = core;
  const { release } = delivery;
  const testRunner = createSessionClient(settings.sessionInternalUrl);
  const mcp = [{ name: 'capabilities', url: settings.mcp.capabilitiesUrl }, { name: 'operations', url: settings.mcp.operationsUrl }];
  const ledger = resources.api.owner('task-runtime');
  const taskRuntime = createTaskRuntimeModule({
    db, k8s, logger, isAdmin: (id) => isAdmin(id), authorizer: project.api, quotas: { quotaLimit: project.api.quotaLimit }, testRunner, testMcp: mcp,
    // RFC-025 第二期：环境落库时在同一事务里投影进资源台账；live 给补投影列出台账里还挂着的 task-runtime 记录。
    // 额度经台账受理（D31：按阶段数，结束中仍占），occupancy 是项目眼下占用的额度单位。
    ledger: { within: (tx) => ledger.within(tx as object), live: async () => (await resources.api.list({})).filter((record) => record.owner.module === 'task-runtime'), occupancy: resources.api.occupancy },
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
    // RFC-025 §11.2：名册的结束与失败照台账里执行记录的阶段（记录沿用执行环境的任务 ID，上级是工作区）。
    executions: { phases: async (workspaceTaskId) => new Map((await resources.api.list({ parentId: workspaceTaskId, kind: 'agent-execution', includeStopped: true })).map((record) => [record.id, record.phase])) },
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
    hold: { holds: (serviceId) => delivery.gateway.api.holdsEvents(serviceId) },
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

function composeAggregates(deps: PlatformModuleDeps, core: ReturnType<typeof composeCore>, delivery: ReturnType<typeof composeDelivery>, runtime: ReturnType<typeof composeRuntime>, resources: ReturnType<typeof composeLedger>) {
  const { db, k8s, settings, logger } = deps;
  const { project, config, data, apiCatalog, isAdmin } = core;
  const serviceOfProject = project.api.resolveServiceOfProject;
  const observability = createObservabilityModule({
    db, k8s, logger, isAdmin: (id) => isAdmin(id), authorizer: project.api, services: { resolveServiceOfProject: serviceOfProject }, slots: delivery.release.api,
    // 健康与告警巡检照服务槽记录（RFC-025 第三期）：资源中心观测 Deployment 与它的 Pod，汇总崩溃重启。
    records: {
      slotRecords: async (projectId) => (await resources.api.list({ projectId, kind: 'service-slot', includeStopped: true }))
        .map((record) => ({ physical: record.display['physical'] ?? '', children: record.children, conditions: record.conditions, phaseSince: record.phaseSince.toISOString() })),
    },
    // 调用链（Design §14）：每个来源都按项目取数——同一个事件投给多个订阅项目时共用 traceId，别的项目的记录不能带出来。
    traces: {
      environments: { traceKeys: runtime.taskRuntime.api.traceKeys, activeTraceIds: runtime.taskRuntime.api.activeTraceIds, list: runtime.taskRuntime.api.listTraceEnvironments },
      deliveries: { traceKeys: runtime.events.api.traceKeys, activeTraceIds: runtime.events.api.activeTraceIds, list: runtime.events.api.listTraceDeliveries },
      businessTasks: { list: runtime.businessTask.api.listTraceTasks },
      sessions: {
        summarize: runtime.session.api.summarizeEvents,
        events: (taskId, page) => runtime.session.api.listEvents(taskId, { sinceSeq: page.afterSeq, limit: page.limit, kinds: page.kinds }),
      },
    },
    listProjectIds: async () => (await project.api.listServices()).map((s) => s.projectId),
  });
  const capabilities = createCapabilitiesModule({
    isAdmin: (id) => isAdmin(id),
    market: { list: project.api.listMarketListings, get: project.api.getMarketListing, slots: (serviceId) => delivery.release.api.getSlots(SYSTEM_ACTOR, serviceId), maintenance: (serviceId) => delivery.gateway.api.maintenanceOf(serviceId) },
    projects: { list: project.api.listProjectPage, read: project.api.readProjectPageEntries, get: project.api.getProjectPageEntry,
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
    db, logger, workerOwner: `${deps.instance}.provisioning`, consumerName: 'provisioning', isAdmin: (id) => isAdmin(id),
    authorizeRetry: async (actor, id) => {
      const role = await project.api.authorize(actor, id, 'view');
      if (role !== 'owner' && role !== 'admin') throw forbidden('只有负责人或管理员可以重新开通项目');
      if ((await project.api.getProject(actor, id)).state !== 'failed') throw precondition('只有开通失败的项目可以重试');
    },
    // 命名空间、额度与网络策略写成台账记录（RFC-025 第四期），由 cluster-control 的调和器建出、被改或被删就补回。
    ledger: { declare: (input) => resources.api.owner('provisioning').declare(input), get: (id) => resources.api.get(id) },
    namespaces: { systemNamespace: settings.systemNamespace },
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
  return { observability, capabilities, provisioning };
}

/**
 * RFC-025 资源中心：台账（L1）只依赖 project 的额度与授权，装在领域模块之前，之后各期的所属模块在构造时就能拿到写入口；
 * 调和器（L2）要按旧标签查任务环境做收编空跑，装在 runtime 之后。
 */
function composeLedger(deps: CompositionDeps, core: ReturnType<typeof composeCore>) {
  const project = core.project.api;
  return createResourcesModule({
    db: deps.db, logger: deps.logger, isAdmin: core.identity.api.isAdmin,
    quotas: { limitFor: project.quotaLimit },
    authorizer: { projectAccess: async (actor, projectId) => ({ operate: (await project.authorize(actor, projectId, 'view')) !== 'tester' }) },
  });
}

function composeControl(deps: CompositionDeps, core: ReturnType<typeof composeCore>, ledger: ReturnType<typeof composeLedger>, runtime: ReturnType<typeof composeRuntime>, gateway: ReturnType<typeof composeDelivery>['gateway']) {
  return createClusterControlModule({
    k8s: deps.k8s, logger: deps.logger, isAdmin: core.identity.api.isAdmin, systemNamespace: deps.settings.systemNamespace,
    // 多副本分工（RFC-025 设计 §6.3）：逐条调和与孤儿回收在资源中心的租约下进行，持有者是这个副本。
    leases: { port: ledger.api.leases, holder: `${deps.instance}.cluster-control` },
    // RFC-025 设计 §7.4：身份索引改读观测缓存的 Pod，全平台只剩这一条 Pod watch。
    pods: { changed: (pod, gone) => gateway.api.syncObservedPod(pod, gone), synced: async (pods) => { await gateway.api.relistObservedPods(pods); } },
    ledger: {
      observe: (input) => ledger.api.observe(input), claimOf: (child) => ledger.api.claimOf(child), get: (id) => ledger.api.get(id),
      listLive: () => ledger.api.list({}), changesSince: ledger.api.changesSince, latestChange: ledger.api.latestChange,
      observeConditions: (id, conditions) => ledger.api.observeConditions(id, conditions), children: (parentId) => ledger.api.list({ parentId, includeStopped: true }),
      // 孤儿 PVC 由资源中心自己认领：工作卷记录归 cluster-control，写「待回收」等管理员确认（设计 §6.4）。
      adoptOrphanVolume: async (child) => {
        const record = await ledger.api.owner('cluster-control').declare({ kind: 'volume', ref: `orphan:${child.namespace ?? ''}/${child.name}`, spec: { children: [{ kind: child.kind, ...(child.namespace ? { namespace: child.namespace } : {}), name: child.name }] }, display: { mode: 'orphaned' } });
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
function composeDataControl(deps: CompositionDeps, ledger: ReturnType<typeof composeLedger>) {
  const resources = ledger.api;
  return createDataControlModule({
    adminUrl: deps.settings.dataPostgres.adminUrl, logger: deps.logger,
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
  const delivery = composeDelivery(deps, core, late, resources);
  const runtime = composeRuntime(deps, core, delivery, late, resources);
  const aggregates = composeAggregates(deps, core, delivery, runtime, resources);
  const cluster = composeCluster(deps, core, delivery, runtime);
  const clusterControl = composeControl(deps, core, resources, runtime, delivery.gateway);
  const dataControl = composeDataControl(deps, resources);
  return { cluster, resources, clusterControl, dataControl, identity: core.identity, project: core.project, config: core.config, data: core.data, scm: core.scm, apiCatalog: core.apiCatalog, agentRuntime: core.agentRuntime, ...delivery, ...runtime, ...aggregates };
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
      controller: m.cluster.internalHttp,
      // devSessionGate 只挂中间件不占路径，必须排在最前：Hono 按注册顺序执行，晚于业务路由就来不及改判身份。
      api: [...m.identity.http.devSessionGate, ...m.project.http, ...m.identity.http.users, ...m.config.http, ...m.agentRuntime.http, ...m.data.http, ...m.scm.http, ...m.apiCatalog.http, ...m.release.http, ...m.gateway.http, ...m.taskRuntime.http, ...m.devSession.http, m.businessTask.http.service, m.businessTask.http.user, ...m.events.http.query, ...m.observability.http, ...m.cluster.http, ...m.capabilities.http, ...m.provisioning.http, ...m.clusterControl.http, ...m.resources.http],
      auth: [...m.identity.http.auth, ...m.identity.http.forwardAuth, ...m.agentRuntime.forwardAuth],
      session: [m.session.http.runner, m.session.http.stream, m.session.http.internal],
      events: [...m.events.http.ingress],
    },
    background: {
      controller: [...m.cluster.workers, ...m.data.workers, ...m.release.workers, ...m.gateway.workers, consumerLifecycle(m.gateway.subscriptions), ...m.taskRuntime.workers, ...m.agentRuntime.workers, ...m.devSession.workers, ...m.businessTask.workers, consumerLifecycle(m.businessTask.subscriptions), ...m.apiCatalog.subscriptions.map(consumerLifecycle), ...m.data.subscriptions.map(consumerLifecycle), ...m.observability.workers, ...m.provisioning.workers, ...m.provisioning.startupTasks, consumerLifecycle(m.provisioning.subscriptions), m.resources.maintenanceWorker, m.clusterControl.observer, m.dataControl.observer],
      // 资源推送流的尾随器（RFC-025 设计 §8.2）：每个 cs-api 副本一个。
      api: [m.resources.streamWorker],
      session: [...m.session.workers],
      events: [...m.events.workers, ...m.events.subscriptions.map(consumerLifecycle)],
    },
    websocket: m.session.websocket,
    migrations: [queueMigrations, eventbusMigrations, m.resources.migrations, m.identity.migrations, m.project.migrations, m.config.migrations, m.agentRuntime.migrations, m.data.migrations, m.scm.migrations, m.apiCatalog.migrations, m.events.migrations, m.release.migrations, m.taskRuntime.migrations, m.devSession.migrations, m.businessTask.migrations, m.session.migrations, m.gateway.migrations, m.observability.migrations, m.cluster.migrations],
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
  return createClusterManagementModule({ metrics: deps.settings.clusterMetrics, resolveReleaseId: (legacy) => deps.identities.resolve('release', [legacy]), physicalOperationId: async (id) => (await deps.identities.aliases('cluster-operation', id)).find((keys) => keys.length === 1 && keys[0] !== id)?.[0] ?? id, db: deps.db, k8s: deps.k8s, instance: deps.instance, logger: deps.logger, systemNamespace: deps.settings.systemNamespace, catalog: installedSystemComponents().map((c) => c.kind === 'Namespace' ? { ...c, name: deps.settings.systemNamespace } : c), isAdmin: core.identity.api.isAdmin,
    authorizeProject: async (actor, projectId) => { await core.project.api.authorize(actor, projectId as ProjectId, 'develop'); },
    metadata: { read: async () => {
      const [projects, taskFacts, slots, plans] = await Promise.all([core.project.api.listClusterProjects(), tasks.listClusterTasks(), release.listClusterSlots(), core.project.api.listServicePlans()]);
      const releases = slots.flatMap((slot) => { const project = projects.find((p) => p.serviceId === slot.serviceId); return project ? [{ ...slot, namespace: project.namespace, serviceName: project.serviceName!, ...(slot.plan ? { maxReplicas: plans.find((p) => p.id === slot.plan)?.maxReplicas ?? 0 } : {}) }] : []; });
      const retained = projects.filter((p) => p.serviceName).flatMap((p) => ['blue', 'green'].map((slot) => ({ namespace: p.namespace, kind: 'Service', name: `${p.serviceName}-${slot}`, reason: '发布槽 Service 跨发布保留' })));
      for (const p of projects) {
        retained.push({ namespace: p.namespace, kind: 'ResourceQuota', name: 'crewstation-project', reason: '项目配额' });
        // 接入容器的服务槽出向独有一条策略（RFC-018）；数字人项目没有它，登记进来会让清单显示不存在的资源。
        const policies = ['crewstation-default', 'crewstation-task-egress', 'crewstation-build-egress', ...(p.kind === 'DigitalWorker' ? [] : ['crewstation-integration-egress'])];
        for (const name of policies) retained.push({ namespace: p.namespace, kind: 'NetworkPolicy', name, reason: '项目网络配置' });
      }
      return { projects, tasks: taskFacts, releases, retained, complete: true };
    } },
    domains: { inspect: async (actor, target, request) => {
      if (target.serviceId && target.kind === 'Deployment') return release.inspectSlotOperation(actor, target, request);
      const capability = target.availableActions.find((a) => a.action === request.action)!;
      try { const domain = await inspectTask(actor, target, request); return { capability: { ...capability, impactSummary: [...capability.impactSummary, ...(domain.volumeMode === 'follow-container' && request.action === 'delete' ? ['此工作区的工作卷也会释放，请先确认所有未提交及未推送内容'] : []), ...(target.purpose === 'development-workspace' && request.action === 'restart' ? ['保留原任务与工作卷；结束该工作区内所有 CLI 和 Agent，新工作区连接后需手动启动'] : [])] }, domain }; } catch (e) { return { capability: { ...capability, enabled: false, reason: e instanceof Error ? e.message : String(e) } }; }
    }, execute: (actor, op, inspection) => op.target.kind === 'Deployment' ? release.executeSlotOperation(actor, op, inspection) : executeTask(actor, op, inspection), observe: (op) => op.target.kind === 'Deployment' ? release.observeSlotOperation(op) : observeTask(op) },
  });
}
