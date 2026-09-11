import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { forbidden, unauthenticated } from '@crewstation/kernel';
import type { Context, MiddlewareHandler } from 'hono';

/** 网关注入的请求身份；业务与平台 API 都只从这里取身份，不自己解析 Cookie 或令牌。 */
export type RequestIdentity =
  | { kind: 'user'; userId: string; name: string; email: string; token?: string }
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
      c.set('identity', {
        kind: 'user',
        userId,
        name: c.req.header(IDENTITY_HEADERS.userName) ?? '',
        email: c.req.header(IDENTITY_HEADERS.userEmail) ?? '',
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
