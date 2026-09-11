import type { AppEnv } from '@crewstation/http';
import { devSessionIdentity } from '@crewstation/http';
import { Hono } from 'hono';
import type { IdentityModuleApi } from '../api/moduleApi';

/**
 * cs-api 上只装中间件、不占任何路径的一段：把带开发会话令牌的请求改判为会话所属用户。
 * 它必须排在 cs-api 路由表的最前面，Hono 按注册顺序执行，排在后面就轮不到在业务路由之前生效。
 */
export function devSessionGate(api: Pick<IdentityModuleApi, 'resolveDevSessionToken'>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.use('*', devSessionIdentity(async (token) => {
    const resolved = await api.resolveDevSessionToken(token);
    if (!resolved) return undefined;
    return {
      userId: resolved.user.id,
      name: resolved.user.name,
      email: resolved.user.email,
      taskId: resolved.taskId,
      projectId: resolved.projectId,
      serviceId: resolved.serviceId,
    };
  }));
  return r;
}
