import type { AuthMethod } from '@crewstation/contracts';
import { AuthMethodSchema, IDENTITY_HEADERS, PLATFORM_INTERNAL_HEADERS } from '@crewstation/contracts';
import { forbidden, unauthenticated } from '@crewstation/kernel';
import type { Context, MiddlewareHandler } from 'hono';

/**
 * 网关注入的请求身份；业务与平台 API 都只从这里取身份，不自己解析 Cookie 或令牌。
 * 唯一的例外是 devSession：它来自调用方自带并经 cs-api 验签的开发会话令牌，由 devSessionIdentity 填入，
 * 表示“这个用户是以某个开发会话的名义在调用”，其可用接口被 devSessionScope 限死在本项目内。
 */
export type RequestIdentity =
  | { kind: 'user'; userId: string; name: string; email: string; authMethod: AuthMethod; token?: string; devSession?: { taskId: string; projectId: string; serviceId: string } }
  | { kind: 'service'; identity: string; project: string; service: string; slot?: string; token?: string };

export interface AppVariables {
  identity?: RequestIdentity;
  requestId: string;
  traceId?: string;
}

export type AppEnv = { Variables: AppVariables };

/** 只信任网关剥离并重新注入后的头；进程只在网关之后可达。 */
export function identityFromHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('requestId', c.req.header(IDENTITY_HEADERS.requestId) ?? Bun.randomUUIDv7());
    const traceId = c.req.header(IDENTITY_HEADERS.traceId);
    if (traceId) c.set('traceId', traceId);
    const userId = c.req.header(IDENTITY_HEADERS.userId);
    const source = c.req.header(IDENTITY_HEADERS.sourceService);
    if (userId) {
      // 认证方式是平台内部头，只在工作台目标上由 ForwardAuth 注入；缺失时按常规登录处理——
      // 它只会让人「关不掉密码登录」，不会放宽任何东西。
      const authMethod = AuthMethodSchema.safeParse(c.req.header(PLATFORM_INTERNAL_HEADERS.authMethod));
      c.set('identity', {
        kind: 'user',
        userId,
        name: c.req.header(IDENTITY_HEADERS.userName) ?? '',
        email: c.req.header(IDENTITY_HEADERS.userEmail) ?? '',
        authMethod: authMethod.success ? authMethod.data : 'password',
        ...tokenOf(c, IDENTITY_HEADERS.identityToken),
      });
    } else if (source) {
      const [project = '', service = ''] = source.split('/');
      const slot = c.req.header(IDENTITY_HEADERS.sourceSlot);
      c.set('identity', { kind: 'service', identity: source, project, service, ...(slot ? { slot } : {}), ...tokenOf(c, IDENTITY_HEADERS.sourceToken) });
    }
    await next();
  };
}

function tokenOf(c: Context<AppEnv>, header: string): { token?: string } {
  const token = c.req.header(header);
  return token ? { token } : {};
}

export function requireUser(c: Context<AppEnv>): Extract<RequestIdentity, { kind: 'user' }> {
  const identity = c.get('identity');
  if (!identity) throw unauthenticated();
  if (identity.kind !== 'user') throw forbidden('此操作需要用户身份');
  return identity;
}

export function requireService(c: Context<AppEnv>): Extract<RequestIdentity, { kind: 'service' }> {
  const identity = c.get('identity');
  if (!identity) throw unauthenticated('缺少来源服务身份');
  if (identity.kind !== 'service') throw forbidden('此操作需要服务身份');
  return identity;
}
