// cs-auth 的配置全部来自环境变量；名字带 CS_ 前缀，值不在代码里出现。
export type IdentityProviderSetting = 'demo' | 'oidc';

export interface AuthSettings {
  port: number;
  databaseUrl: string;
  userDomain: string;
  serviceDomain: string;
  /** 会话 Cookie 的 Domain；缺省为用户域前加点，让工作台与各业务主机共用登录。 */
  cookieDomain: string;
  /** 网关对外是否 https（CS_PUBLIC_SCHEME=https）；决定 Cookie Secure 与跳转 scheme。 */
  secure: boolean;
  sessionTtlSeconds: number;
  adminEmails: string[];
  identityProvider: IdentityProviderSetting;
  defaultMaxConcurrentTasks: number;
  defaultServicePlan: string;
}

export function loadSettings(env: Record<string, string | undefined> = process.env): AuthSettings {
  const databaseUrl = env.CS_DATABASE_URL;
  if (!databaseUrl) throw new Error('缺少 CS_DATABASE_URL');
  const userDomain = env.CS_USER_DOMAIN ?? 'cs.localhost';
  const identityProvider = env.CS_IDENTITY_PROVIDER ?? 'demo';
  if (identityProvider !== 'demo' && identityProvider !== 'oidc') throw new Error(`CS_IDENTITY_PROVIDER 只能是 demo 或 oidc，实际 ${identityProvider}`);
  return {
    port: Number(env.CS_CS_AUTH_PORT ?? env.CS_AUTH_PORT ?? 8081),
    databaseUrl,
    userDomain,
    serviceDomain: env.CS_SERVICE_DOMAIN ?? 'svc.cs.internal',
    cookieDomain: env.CS_COOKIE_DOMAIN ?? `.${userDomain}`,
    secure: (env.CS_PUBLIC_SCHEME ?? 'http') === 'https',
    sessionTtlSeconds: Number(env.CS_SESSION_TTL_SECONDS ?? 8 * 3600),
    adminEmails: (env.CS_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    identityProvider,
    defaultMaxConcurrentTasks: Number(env.CS_DEFAULT_MAX_CONCURRENT_TASKS ?? 3),
    defaultServicePlan: env.CS_DEFAULT_SERVICE_PLAN ?? 'standard-small',
  };
}
