/**
 * 业务接入约定表（Plan T0.3）：业务代码只依赖这里列出的名字，平台任何一侧改名都算破坏性变更。
 * 同一份内容由能力说明 MCP 与工作台能力页原样展示。
 */
export const IDENTITY_HEADERS = {
  /** 用户域：网关注入的已鉴权用户，明文可读。 */
  userId: 'x-cs-user-id',
  userName: 'x-cs-user-name',
  userEmail: 'x-cs-user-email',
  /** 用户域：平台签名 JWT，aud 绑定目标服务，业务需要时可验签。 */
  identityToken: 'x-cs-identity-token',
  /** 服务域：网关按源 Pod IP 解析出的调用方服务身份（`<project>/<service>`）。 */
  sourceService: 'x-cs-source-service',
  sourceSlot: 'x-cs-source-slot',
  /** 服务域：平台签名的来源令牌，事件推送与服务间调用都携带。 */
  sourceToken: 'x-cs-source-token',
  traceId: 'x-cs-trace-id',
  requestId: 'x-cs-request-id',
} as const;

/** 业务容器内可读的环境变量；值由平台在部署与开发会话启动时注入。 */
export const PLATFORM_ENV = {
  project: 'CS_PROJECT',
  service: 'CS_SERVICE',
  slot: 'CS_SLOT',
  /** production｜development：两槽都是 production，开发会话是 development。 */
  environment: 'CS_ENVIRONMENT',
  userDomain: 'CS_USER_DOMAIN',
  serviceDomain: 'CS_SERVICE_DOMAIN',
  /** 平台 API 的服务域地址，业务以自身身份调用（创建业务任务等）。 */
  platformApiUrl: 'CS_PLATFORM_API_URL',
  /** 内部 API 的服务域前缀，形如 `http://api.svc.cs.internal/api/`；后接 `<proxy>/<path>`。 */
  internalApiBase: 'CS_INTERNAL_API_BASE',
  jwksUrl: 'CS_JWKS_URL',
  databaseUrl: 'CS_DATABASE_URL',
  port: 'PORT',
  taskId: 'CS_TASK_ID',
  traceId: 'CS_TRACE_ID',
} as const;

export const PLATFORM_PATHS = {
  health: '/healthz',
  /** 服务域上内部 API 的路由前缀：`/api/<proxy>/<upstream path>`。 */
  internalApiPrefix: '/api/',
  jwks: '/.well-known/jwks.json',
} as const;

/** JWT 声明名；identity token 与 source token 都遵守。 */
export const TOKEN_CLAIMS = {
  issuer: 'crewstation',
  subjectPrefixUser: 'user:',
  subjectPrefixService: 'service:',
  audiencePrefixService: 'service:',
  kind: 'cs_kind',
  project: 'cs_project',
  slot: 'cs_slot',
  traceId: 'cs_trace_id',
} as const;

/** 域名模式；`{project}` 与 `{service}` 由安装配置的域名后缀补全。 */
export const HOST_PATTERNS = {
  console: 'console.{userDomain}',
  prod: '{project}.{userDomain}',
  preview: 'preview.{project}.{userDomain}',
  devPreview: 'dev.{project}.{userDomain}',
  service: '{service}.{serviceDomain}',
  platformApi: 'api.{serviceDomain}',
  events: 'events.{serviceDomain}',
  mcpCapabilities: 'mcp-capabilities.{serviceDomain}',
  mcpOperations: 'mcp-operations.{serviceDomain}',
} as const;

/**
 * 服务域上属于平台自身的主机前缀。它们不是数字人暴露的 API，不能按操作键判定：
 * 按操作键判定会要求有人去登记 `mcp-operations:POST:/mcp` 这种键，而没有任何一方会去登记。
 */
export const PLATFORM_SERVICE_HOSTS = {
  platformApi: 'api',
  events: 'events',
  mcpCapabilities: 'mcp-capabilities',
  mcpOperations: 'mcp-operations',
} as const;

export type PlatformServiceHost = keyof typeof PLATFORM_SERVICE_HOSTS;

export type IdentityHeaderName = (typeof IDENTITY_HEADERS)[keyof typeof IDENTITY_HEADERS];
export type PlatformEnvName = (typeof PLATFORM_ENV)[keyof typeof PLATFORM_ENV];
