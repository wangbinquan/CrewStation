export interface PlatformSettings {
  clusterMetrics?: { enabled: boolean; exporterToken: string; prometheusUrl: string; prometheusToken: string; probeToken: string; probeRoot: string; probePort: number };
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
  /** 管理员从工作机推送档位镜像的主机名（经网关，RFC-006 C18）。 */
  registryPushHost: string;
  /** 集群内访问平台仓库 HTTP API 的协议（解析镜像摘要）。 */
  registryScheme: 'http' | 'https';
  /** 平台底座镜像在仓库里的路径与标签：管理员据此 FROM（RFC-006 C3）。 */
  baseImage: { repository: string; tag: string };
  builderImage: string;
  buildkitAddress: string;
  taskImage: string;
  sessionRunnerUrl: string;
  sessionInternalUrl: string;
  gitlab: { baseUrl: string; groupPath: string; platformToken: string; botName: string };
  mcp: { capabilitiesUrl: string; operationsUrl: string };
  idleMinutes: number;
  selfAddress: string;
  /** 安装期下发的引导令牌；只能用来创建首位管理员，完成态以数据库为准（RFC-005 §8）。 */
  bootstrapToken: string | undefined;
  /** `CS_PASSWORD_LOGIN=force-on`：IdP 全不可达时的破窗口，压过库内登录策略。 */
  passwordLoginForcedOn: boolean;
  sessionTtlSeconds: number;
  /**
   * 工作区（开发会话、业务任务）的容器由谁建（RFC-025 I25）：`ledger` 由资源中心照记录建出（缺省）；
   * `CS_WORKLOAD_CREATION=owner` 回退为 task-runtime 受理时自己建——迁移期的回退手段。已由资源中心建出的环境恢复时仍走资源中心。
   */
  workloadCreation: 'ledger' | 'owner';
  /**
   * 生产库、开发库由谁建（RFC-025 I28）：`data-control` 由资源中心的数据面调和器建、口令它存（缺省）；
   * `CS_DATA_PROVISIONING=data` 回退为 data 受理时自己建。已建好的库各按当时的方式取连接串。
   */
  dataProvisioning: 'data-control' | 'data';
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
    clusterMetrics: { enabled: env.CS_CLUSTER_METRICS_ENABLED === 'true', exporterToken: env.CS_CLUSTER_METRICS_TOKEN ?? '', prometheusUrl: env.CS_PROMETHEUS_URL ?? `http://prometheus.${systemNamespace}.svc.cluster.local:9090`, prometheusToken: env.CS_PROMETHEUS_TOKEN ?? '', probeToken: env.CS_STORAGE_PROBE_TOKEN ?? '', probeRoot: env.CS_STORAGE_PROBE_HOST_ROOT ?? '', probePort: num(env.CS_STORAGE_PROBE_PORT, 8095) },
    databaseUrl,
    userDomain: env.CS_USER_DOMAIN ?? 'cs.localhost',
    serviceDomain,
    systemNamespace,
    publicScheme: env.CS_PUBLIC_SCHEME === 'https' ? 'https' : 'http',
    adminEmails: (env.CS_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    secretKeyBase64: required(env, 'CS_SECRET_KEY'),
    defaultMaxConcurrentTasks: num(env.CS_DEFAULT_MAX_CONCURRENT_TASKS, 3),
    defaultServicePlan: env.CS_DEFAULT_SERVICE_PLAN ?? '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10',
    defaultTaskProfile: env.CS_DEFAULT_TASK_PROFILE ?? '01a0bf5d-8f4b-7001-8458-107366e7de39',
    dataPostgres: { adminUrl: dataAdminUrl, visibleHost: visible.hostname, visiblePort: num(visible.port, 5432) },
    registryBase: env.CS_REGISTRY_BASE ?? `registry.${systemNamespace}.svc.cluster.local:5000`,
    registryPushHost: env.CS_REGISTRY_PUSH_HOST ?? `registry.${env.CS_USER_DOMAIN ?? 'cs.localhost'}`,
    registryScheme: env.CS_REGISTRY_SCHEME === 'https' ? 'https' : 'http',
    baseImage: { repository: env.CS_BASE_IMAGE_REPOSITORY ?? 'crewstation/task-runtime', tag: env.CS_BASE_IMAGE_TAG ?? 'dev' },
    builderImage: env.CS_BUILDER_IMAGE ?? 'cs-builder:dev',
    buildkitAddress: env.CS_BUILDKIT_ADDRESS ?? `tcp://buildkitd.${systemNamespace}.svc.cluster.local:1234`,
    taskImage: env.CS_TASK_IMAGE ?? 'cs-task-runtime:dev',
    sessionRunnerUrl: env.CS_SESSION_RUNNER_URL ?? `ws://cs-session.${systemNamespace}.svc.cluster.local:8083/runner`,
    sessionInternalUrl: env.CS_SESSION_INTERNAL_URL ?? `http://cs-session.${systemNamespace}.svc.cluster.local:8083`,
    gitlab: { baseUrl: env.CS_GITLAB_URL ?? 'http://host.docker.internal:8929', groupPath: env.CS_GITLAB_GROUP ?? 'crewstation', platformToken: env.CS_GITLAB_TOKEN ?? '', botName: env.CS_GITLAB_BOT_NAME ?? 'CrewStation Bot' },
    mcp: { capabilitiesUrl: env.CS_MCP_CAPABILITIES_URL ?? `http://mcp-capabilities.${serviceDomain}/mcp`, operationsUrl: env.CS_MCP_OPERATIONS_URL ?? `http://mcp-operations.${serviceDomain}/mcp` },
    idleMinutes: num(env.CS_IDLE_MINUTES, 120),
    selfAddress: env.CS_SELF_ADDRESS ?? `http://${env.POD_IP ?? '127.0.0.1'}:${portFrom(env, 'cs-session', 8083)}`,
    bootstrapToken: env.CS_BOOTSTRAP_TOKEN || undefined,
    passwordLoginForcedOn: env.CS_PASSWORD_LOGIN === 'force-on',
    sessionTtlSeconds: num(env.CS_SESSION_TTL_SECONDS, 28800),
    workloadCreation: env.CS_WORKLOAD_CREATION === 'owner' ? 'owner' : 'ledger',
    dataProvisioning: env.CS_DATA_PROVISIONING === 'data' ? 'data' : 'data-control',
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
