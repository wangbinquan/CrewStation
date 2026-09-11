// cs-api 的配置全部来自环境变量；名字带 CS_ 前缀，值不在代码里出现。
export interface ApiSettings {
  port: number;
  databaseUrl: string;
  userDomain: string;
  serviceDomain: string;
  systemNamespace: string;
  adminEmails: string[];
  defaultMaxConcurrentTasks: number;
  defaultServicePlan: string;
  /** 32 字节 base64；加密 Secret 配置值与数据连接串。 */
  secretKeyBase64: string;
  dataPostgres: { adminUrl: string; visibleHost: string; visiblePort: number };
}

export function loadSettings(env: Record<string, string | undefined> = process.env): ApiSettings {
  const databaseUrl = required(env, 'CS_DATABASE_URL');
  const dataAdminUrl = env.CS_DATA_POSTGRES_ADMIN_URL ?? databaseUrl;
  const visible = new URL(env.CS_DATA_POSTGRES_VISIBLE_URL ?? dataAdminUrl);
  return {
    port: Number(env.CS_CS_API_PORT ?? env.CS_API_PORT ?? 8080),
    databaseUrl,
    userDomain: env.CS_USER_DOMAIN ?? 'cs.localhost',
    serviceDomain: env.CS_SERVICE_DOMAIN ?? 'svc.cs.internal',
    systemNamespace: env.CS_SYSTEM_NAMESPACE ?? 'crewstation-system',
    adminEmails: (env.CS_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    defaultMaxConcurrentTasks: Number(env.CS_DEFAULT_MAX_CONCURRENT_TASKS ?? 3),
    defaultServicePlan: env.CS_DEFAULT_SERVICE_PLAN ?? 'standard-small',
    secretKeyBase64: required(env, 'CS_SECRET_KEY'),
    dataPostgres: { adminUrl: dataAdminUrl, visibleHost: visible.hostname, visiblePort: Number(visible.port || 5432) },
  };
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}
