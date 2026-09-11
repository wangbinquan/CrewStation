import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { forbidden, unauthenticated } from '@crewstation/kernel';
import type { MiddlewareHandler } from 'hono';
import { devSessionScopeDenial } from './devSessionScope';
import type { AppEnv } from './identity';

/** 校验通过后的开发会话调用者：会话所属用户，外加令牌绑死的会话、项目与服务。 */
export interface DevSessionPrincipal {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly serviceId: string;
}

/** 由 identity 模块提供的验签入口；无效、过期或会话已释放一律返回 undefined，不区分原因。 */
export type DevSessionTokenResolver = (token: string) => Promise<DevSessionPrincipal | undefined>;

/**
 * 开发会话令牌 → 用户身份（Design §5.9：每次调用经 cs-api 校验开发会话授权，会话释放后拒绝）。
 * 必须挂在 identityFromHeaders 之后、各模块路由之前：带上令牌的请求原本被网关注入成服务身份，
 * 这里改判为会话所属用户，否则所有面向用户的 /v1 路由都会以“此操作需要用户身份”回绝。
 * 没带令牌就原样放过，不影响浏览器与 CLI 的既有路径。
 */
export function devSessionIdentity(resolve: DevSessionTokenResolver): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = c.req.header(IDENTITY_HEADERS.devSessionToken);
    if (!token) return next();
    const principal = await resolve(token);
    if (!principal) throw unauthenticated('开发会话令牌无效、已过期，或该开发会话已释放');
    const denial = devSessionScopeDenial(c.req.method, new URL(c.req.url), principal);
    if (denial) throw forbidden(denial);
    c.set('identity', {
      kind: 'user',
      userId: principal.userId,
      name: principal.name,
      email: principal.email,
      devSession: { taskId: principal.taskId, projectId: principal.projectId, serviceId: principal.serviceId },
    });
    await next();
  };
}
