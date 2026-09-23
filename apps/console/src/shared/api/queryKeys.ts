/**
 * React Query 键：第一段是资源名，其后是定位参数。
 * 失效时按前缀匹配（`queryClient.invalidateQueries({ queryKey: queryKeys.releases(serviceId) })`）。
 */
export const queryKeys = {
  cluster: (part: string, query?: unknown) => ['cluster', part, query] as const,
  me: () => ['me'] as const,
  users: () => ['users'] as const,
  loginPolicy: () => ['auth', 'login-policy'] as const,
  authProviders: () => ['auth', 'providers'] as const,
  identityForwarding: () => ['auth', 'forwarding'] as const,
  projects: () => ['projects'] as const,
  projectSummaries: (userId: string, search: unknown) => ['projects', 'summaries', userId, search] as const,
  projectSummary: (projectId: string, userId: string) => ['projects', projectId, 'summary', userId] as const,
  adminProjects: () => ['projects', 'admin'] as const,
  adminProjectPage: (search: unknown) => ['projects', 'admin', 'page', search] as const,
  accessRequestPage: (search: unknown) => ['access-requests', 'page', search] as const,
  /** 按 kind 过滤的项目列表（RFC-002）：挂在 projects 前缀下，建项目后一次失效连带刷新。 */
  projectsByKind: (kinds: readonly string[]) => ['projects', 'kind', kinds.join(',')] as const,
  project: (projectId: string) => ['projects', projectId] as const,
  projectIdentity: (projectId: string, userId: string, previewOnly: boolean) => ['projects', projectId, 'identity', userId, previewOnly] as const,
  members: (projectId: string) => ['projects', projectId, 'members'] as const,
  quota: (projectId: string) => ['projects', projectId, 'quota'] as const,
  services: () => ['services'] as const,
  service: (serviceId: string) => ['services', serviceId] as const,
  slots: (serviceId: string) => ['services', serviceId, 'slots'] as const,
  repository: (serviceId: string) => ['services', serviceId, 'repository'] as const,
  tags: (serviceId: string) => ['services', serviceId, 'tags'] as const,
  releases: (serviceId: string) => ['services', serviceId, 'releases'] as const,
  release: (releaseId: string) => ['releases', releaseId] as const,
  trafficSwitches: (serviceId: string) => ['services', serviceId, 'traffic-switches'] as const,
  /** RFC-021：待命槽的下线、重新部署、推迟与提醒记录，并进发布记录时间线。 */
  slotEvents: (serviceId: string) => ['services', serviceId, 'slot-events'] as const,
  /** RFC-021：正式版本的维护状态与记录；发布页与概览共用一份缓存。 */
  maintenance: (serviceId: string) => ['services', serviceId, 'maintenance'] as const,
  branches: (projectId: string) => ['projects', projectId, 'branches'] as const,
  devSession: (projectId: string) => ['projects', projectId, 'dev-session'] as const,
  nativeTerminals: (taskId: string) => ['tasks', taskId, 'native-terminals'] as const,
  versionComparison: (projectId: string, taskId: string) => ['projects', projectId, 'dev-session', taskId, 'comparison'] as const,
  comparisonDetails: (projectId: string, comparisonId: string, tab: string, cursor?: string, path?: string) => ['projects', projectId, 'comparison-details', comparisonId, tab, cursor, path] as const,
  task: (taskId: string) => ['tasks', taskId] as const,
  agents: (taskId: string) => ['tasks', taskId, 'agents'] as const,
  dataBindings: (projectId: string) => ['projects', projectId, 'data-bindings'] as const,
  pendingDataBindings: (projectId: string) => ['projects', projectId, 'data-bindings', 'pending'] as const,
  dataResources: (projectId: string) => ['projects', projectId, 'data-resources'] as const,
  /** 项目成员的只读盘点（RFC-019）：挂在项目前缀下，快照 id 不进键，靠轮询换数据。 */
  projectClusterResources: (projectId: string) => ['projects', projectId, 'cluster-resources'] as const,
  config: (projectId: string, env: string) => ['projects', projectId, 'config', env] as const,
  operations: (serviceId?: string) => (serviceId === undefined ? (['operations'] as const) : (['operations', serviceId] as const)),
  /** 代理清单挂在 operations 前缀下：授权变化时按前缀一次失效即可连带刷新。 */
  apiProxies: () => ['operations', 'proxies'] as const,
  /** 裁剪后的 OpenAPI 按“服务＋代理”缓存：同一代理对不同服务裁剪结果不同。 */
  openapiSpec: (serviceId: string, proxy: string) => ['operations', 'spec', serviceId, proxy] as const,
  accessRequests: (serviceId?: string) => (serviceId === undefined ? (['access-requests'] as const) : (['access-requests', serviceId] as const)),
  subscriptions: (projectId: string) => ['projects', projectId, 'subscriptions'] as const,
  deliveries: (projectId: string) => ['projects', projectId, 'deliveries'] as const,
  /** 事件类型目录是平台级的，与项目无关。 */
  eventTypes: () => ['catalog', 'event-types'] as const,
  logs: (projectId: string) => ['projects', projectId, 'logs'] as const,
  /** 健康态的路由是 /v1/projects/:projectId/health，键也按项目定位。 */
  projectHealth: (projectId: string) => ['projects', projectId, 'health'] as const,
  alerts: (projectId: string) => ['projects', projectId, 'alerts'] as const,
  alertSubscriptions: (projectId: string) => ['projects', projectId, 'alert-subscriptions'] as const,
  trace: (traceId: string) => ['traces', traceId] as const,
  capabilities: (projectId: string) => ['projects', projectId, 'capabilities'] as const,
  servicePlans: () => ['service-plans'] as const,
  projectTemplates: () => ['project-templates', 'admin'] as const,
  taskProfiles: () => ['task-profiles'] as const,
  /**
   * 算力档位（RFC-006）：租户投影与管理面分开缓存，两者字段不同；都挂在 compute-profiles 前缀下，
   * 管理员一次写入按前缀失效，租户下拉与管理列表一起刷新。测试在运行中按短间隔轮询。
   */
  computeProfiles: (projectId?: string) => projectId ? ['compute-profiles', projectId] as const : ['compute-profiles'] as const,
  adminComputeProfiles: () => ['compute-profiles', 'admin'] as const,
  adminComputeProfile: (name: string) => ['compute-profiles', 'admin', name] as const,
  profileTest: (name: string, testId: string) => ['compute-profiles', 'admin', name, 'tests', testId] as const,
  /** 平台仓库的推送地址与底座镜像；签发的推送凭据不缓存。 */
  runtimeImages: () => ['runtime-images'] as const,
  /** 网关的只读派生状态；重算后按 gateway 前缀一次失效。 */
  gateway: () => ['gateway'] as const,
  gatewayRoutes: () => ['gateway', 'routes'] as const,
  gatewayAllowlist: () => ['gateway', 'allowlist'] as const,
  /** RFC-021：平台设置里的自动下线时长（仅管理员）。 */
  autoOfflinePolicy: () => ['platform-settings', 'auto-offline'] as const,
} as const;
