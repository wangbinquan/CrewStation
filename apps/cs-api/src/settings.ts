// cs-api 的配置全部来自环境变量；名字带 CS_ 前缀，值不在代码里出现。
export interface ApiSettings {
  port: number;
  databaseUrl: string;
  userDomain: string;
  serviceDomain: string;
  adminEmails: string[];
  defaultMaxConcurrentTasks: number;
  defaultServicePlan: string;
}

export function loadSettings(env: Record<string, string | undefined> = process.env): ApiSettings {
  const databaseUrl = env.CS_DATABASE_URL;
  if (!databaseUrl) throw new Error('缺少 CS_DATABASE_URL');
  return {
    port: Number(env.CS_CS_API_PORT ?? env.CS_API_PORT ?? 8080),
    databaseUrl,
    userDomain: env.CS_USER_DOMAIN ?? 'cs.localhost',
    serviceDomain: env.CS_SERVICE_DOMAIN ?? 'svc.cs.internal',
    adminEmails: (env.CS_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    defaultMaxConcurrentTasks: Number(env.CS_DEFAULT_MAX_CONCURRENT_TASKS ?? 3),
    defaultServicePlan: env.CS_DEFAULT_SERVICE_PLAN ?? 'standard-small',
  };
}
