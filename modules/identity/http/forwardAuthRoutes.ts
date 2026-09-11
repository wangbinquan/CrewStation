import { IDENTITY_HEADERS } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import type { IdentityModuleApi, ServiceAuthDecision, UserAuthDecision } from '../api/moduleApi';

/**
 * Traefik ForwardAuth 端点：网关以 GET 调用并带 X-Forwarded-Method／Proto／Host／Uri／For 与原请求头。
 * 2xx 放行并把 authResponseHeaders 列出的响应头复制进原请求；其他状态连同 Location／Set-Cookie 原样回给客户端。
 */
export function forwardAuthRoutes(api: IdentityModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.all('/forward-auth/user', async (c) => {
    const sessionToken = getCookie(c, api.sessionCookie.name);
    const decision = await api.authorizeUserRequest({
      scheme: c.req.header('x-forwarded-proto'),
      host: forwardedHost(c),
      uri: c.req.header('x-forwarded-uri') ?? '/',
      method: c.req.header('x-forwarded-method') ?? c.req.method,
      ...(sessionToken ? { sessionToken } : {}),
      accept: c.req.header('accept'),
    });
    if (sessionToken && (decision.kind === 'login-redirect' || decision.kind === 'unauthenticated')) {
      deleteCookie(c, api.sessionCookie.name, { domain: api.sessionCookie.domain, path: api.sessionCookie.path });
    }
    return userResponse(c, decision);
  });
  r.all('/forward-auth/service', async (c) => {
    const decision = await api.authorizeServiceRequest({
      forwardedFor: c.req.header('x-forwarded-for'),
      host: forwardedHost(c),
      method: c.req.header('x-forwarded-method') ?? c.req.method,
      uri: c.req.header('x-forwarded-uri') ?? '/',
      traceId: c.req.header(IDENTITY_HEADERS.traceId),
    });
    return serviceResponse(c, decision);
  });
  return r;
}

function forwardedHost(c: Context<AppEnv>): string {
  return c.req.header('x-forwarded-host') ?? c.req.header('host') ?? '';
}

function requestId(c: Context<AppEnv>): string {
  return c.get('requestId') ?? Bun.randomUUIDv7();
}

function userResponse(c: Context<AppEnv>, decision: UserAuthDecision): Response {
  switch (decision.kind) {
    case 'allow': {
      c.header(IDENTITY_HEADERS.userId, decision.injected.userId);
      c.header(IDENTITY_HEADERS.userName, decision.injected.userName);
      c.header(IDENTITY_HEADERS.userEmail, decision.injected.userEmail);
      c.header(IDENTITY_HEADERS.identityToken, decision.injected.identityToken);
      c.header(IDENTITY_HEADERS.requestId, requestId(c));
      return c.body(null, 200);
    }
    case 'login-redirect':
      return c.redirect(decision.location, 302);
    case 'unauthenticated':
      return c.json({ error: 'unauthenticated', message: decision.message, details: {} }, 401);
    case 'forbidden':
      return c.json({ error: 'forbidden', message: decision.message, details: {} }, 403);
  }
}

function serviceResponse(c: Context<AppEnv>, decision: ServiceAuthDecision): Response {
  if (decision.kind === 'forbidden') {
    return c.json({ error: 'forbidden', message: decision.message, details: decision.reason ? { reason: decision.reason } : {} }, 403);
  }
  c.header(IDENTITY_HEADERS.sourceService, decision.injected.sourceService);
  if (decision.injected.sourceSlot) c.header(IDENTITY_HEADERS.sourceSlot, decision.injected.sourceSlot);
  c.header(IDENTITY_HEADERS.sourceToken, decision.injected.sourceToken);
  c.header(IDENTITY_HEADERS.traceId, decision.injected.traceId);
  c.header(IDENTITY_HEADERS.requestId, requestId(c));
  return c.body(null, 200);
}
