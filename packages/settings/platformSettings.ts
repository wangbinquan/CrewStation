export interface PlatformSettings {
  databaseUrl: string;
  userDomain: string;
  serviceDomain: string;
  systemNamespace: string;
  publicScheme: 'http' | 'https';
  adminEmails: string[];
  secretKeyBase64: string;
  defaultMaxConcurrentTasks: number;
  defaultServicePlan: string;
  defaultTaskProfile: string;
  dataPostgres: { adminUrl: string; visibleHost: string; visiblePort: number };
  registryBase: string;
  builderImage: string;
  buildkitAddress: string;
  taskImage: string;
  sessionRunnerUrl: string;
  sessionInternalUrl: string;
  gitlab: { baseUrl: string; groupPath: string; platformToken: string; botName: string };
  mcp: { capabilitiesUrl: string; operationsUrl: string };
  maintenanceWindow: boolean;
  idleMinutes: number;
  agentEnvSecretName: string | undefined;
  selfAddress: string;
  identityProvider: 'demo' | 'oidc';
  sessionTtlSeconds: number;
}

const num = (v: string | undefined, fallback: number): number => (v === undefined || v === '' ? fallback : Number(v));

/** 所有进程共用一份读取逻辑；缺关键变量时启动即失败，不带默认值的只有数据库地址、密钥与 GitLab 令牌。 */
export function loadPlatformSettings(env: Record<string, string | undefined> = process.env): PlatformSettings {
  const databaseUrl = required(env, 'CS_DATABASE_URL');
  const systemNamespace = env.CS_SYSTEM_NAMESPACE ?? 'crewstation-system';
  const serviceDomain = env.CS_SERVICE_DOMAIN ?? 'svc.cs.internal';
  const dataAdminUrl = env.CS_DATA_POSTGRES_ADMIN_URL ?? databaseUrl;
  const visible = new URL(env.CS_DATA_POSTGRES_VISIBLE_URL ?? dataAdminUrl);
  return {
    databaseUrl,
    userDomain: env.CS_USER_DOMAIN ?? 'cs.localhost',
    serviceDomain,
    systemNamespace,
    publicScheme: env.CS_PUBLIC_SCHEME === 'https' ? 'https' : 'http',
    adminEmails: (env.CS_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    secretKeyBase64: required(env, 'CS_SECRET_KEY'),
    defaultMaxConcurrentTasks: num(env.CS_DEFAULT_MAX_CONCURRENT_TASKS, 3),
    defaultServicePlan: env.CS_DEFAULT_SERVICE_PLAN ?? 'standard-small',
    defaultTaskProfile: env.CS_DEFAULT_TASK_PROFILE ?? 'coding-medium',
    dataPostgres: { adminUrl: dataAdminUrl, visibleHost: visible.hostname, visiblePort: num(visible.port, 5432) },
    registryBase: env.CS_REGISTRY_BASE ?? `registry.${systemNamespace}.svc.cluster.local:5000`,
    builderImage: env.CS_BUILDER_IMAGE ?? 'cs-builder:dev',
    buildkitAddress: env.CS_BUILDKIT_ADDRESS ?? `tcp://buildkitd.${systemNamespace}.svc.cluster.local:1234`,
    taskImage: env.CS_TASK_IMAGE ?? 'cs-task-runtime:dev',
    sessionRunnerUrl: env.CS_SESSION_RUNNER_URL ?? `ws://cs-session.${systemNamespace}.svc.cluster.local:8083/runner`,
    sessionInternalUrl: env.CS_SESSION_INTERNAL_URL ?? `http://cs-session.${systemNamespace}.svc.cluster.local:8083`,
    gitlab: { baseUrl: env.CS_GITLAB_URL ?? 'http://host.docker.internal:8929', groupPath: env.CS_GITLAB_GROUP ?? 'crewstation', platformToken: env.CS_GITLAB_TOKEN ?? '', botName: env.CS_GITLAB_BOT_NAME ?? 'CrewStation Bot' },
    mcp: { capabilitiesUrl: env.CS_MCP_CAPABILITIES_URL ?? `http://mcp-capabilities.${serviceDomain}/mcp`, operationsUrl: env.CS_MCP_OPERATIONS_URL ?? `http://mcp-operations.${serviceDomain}/mcp` },
    maintenanceWindow: env.CS_MAINTENANCE_WINDOW === 'true',
    idleMinutes: num(env.CS_IDLE_MINUTES, 120),
    agentEnvSecretName: env.CS_AGENT_ENV_SECRET || undefined,
    selfAddress: env.CS_SELF_ADDRESS ?? `http://${env.POD_IP ?? '127.0.0.1'}:${env.CS_CS_SESSION_PORT ?? env.CS_SESSION_PORT ?? '8083'}`,
    identityProvider: env.CS_IDENTITY_PROVIDER === 'oidc' ? 'oidc' : 'demo',
    sessionTtlSeconds: num(env.CS_SESSION_TTL_SECONDS, 28800),
  };
}

export function portFrom(env: Record<string, string | undefined>, app: string, fallback: number): number {
  const key = `CS_${app.toUpperCase().replace(/-/g, '_')}_PORT`;
  return num(env[key], fallback);
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}
