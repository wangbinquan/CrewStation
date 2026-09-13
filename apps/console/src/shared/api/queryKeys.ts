/**
 * React Query 键：第一段是资源名，其后是定位参数。
 * 失效时按前缀匹配（`queryClient.invalidateQueries({ queryKey: queryKeys.releases(serviceId) })`）。
 */
export const queryKeys = {
  me: () => ['me'] as const,
  users: () => ['users'] as const,
  projects: () => ['projects'] as const,
  projectSummaries: (userId: string, search: unknown) => ['projects', 'summaries', userId, search] as const,
  projectSummary: (projectId: string, userId: string) => ['projects', projectId, 'summary', userId] as const,
  adminProjects: () => ['projects', 'admin'] as const,
  adminProjectPage: (search: unknown) => ['projects', 'admin', 'page', search] as const,
  accessRequestPage: (search: unknown) => ['access-requests', 'page', search] as const,
  egressRequestPage: (search: unknown) => ['egress', 'requests', 'page', search] as const,
  /** 按 kind 过滤的项目列表（RFC-002）：挂在 projects 前缀下，建项目后一次失效连带刷新。 */
  projectsByKind: (kinds: readonly string[]) => ['projects', 'kind', kinds.join(',')] as const,
  project: (projectId: string) => ['projects', projectId] as const,
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
  branches: (projectId: string) => ['projects', projectId, 'branches'] as const,
  devSession: (projectId: string) => ['projects', projectId, 'dev-session'] as const,
  versionComparison: (projectId: string, taskId: string) => ['projects', projectId, 'dev-session', taskId, 'comparison'] as const,
  comparisonDetails: (projectId: string, comparisonId: string, tab: string, cursor?: string, path?: string) => ['projects', projectId, 'comparison-details', comparisonId, tab, cursor, path] as const,
  task: (taskId: string) => ['tasks', taskId] as const,
  agents: (taskId: string) => ['tasks', taskId, 'agents'] as const,
  dataBindings: (projectId: string) => ['projects', projectId, 'data-bindings'] as const,
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
  egressEntries: (projectId?: string) => (projectId === undefined ? (['egress', 'entries'] as const) : (['egress', 'entries', projectId] as const)),
  egressRequests: (projectId?: string) => (projectId === undefined ? (['egress', 'requests'] as const) : (['egress', 'requests', projectId] as const)),
  egressBlocked: (projectId: string) => ['egress', 'blocked', projectId] as const,
  servicePlans: () => ['service-plans'] as const,
  projectTemplates: () => ['project-templates', 'admin'] as const,
  taskProfiles: () => ['task-profiles'] as const,
  /** 算力档位（RFC-001）：租户投影与管理面全量分开缓存，两者字段不同。 */
  computeProfiles: () => ['compute-profiles'] as const,
  computeProfilesFull: () => ['compute-profiles', 'full'] as const,
  /** 网关的只读派生状态；重算后按 gateway 前缀一次失效。 */
  gateway: () => ['gateway'] as const,
  gatewayRoutes: () => ['gateway', 'routes'] as const,
  gatewayAllowlist: () => ['gateway', 'allowlist'] as const,
} as const;
