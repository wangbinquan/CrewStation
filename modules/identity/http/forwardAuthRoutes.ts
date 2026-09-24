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
    return userResponse(c, decision, api);
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

function userResponse(c: Context<AppEnv>, decision: UserAuthDecision, api: IdentityModuleApi): Response {
  const sessionCookieName = api.sessionCookie.name;
  switch (decision.kind) {
    case 'allow': {
      c.header(IDENTITY_HEADERS.userId, decision.injected.userId);
      c.header(IDENTITY_HEADERS.identityToken, decision.injected.identityToken);
      // 其余身份头按「身份转发」配置逐项注入：不在生效集里的字段这里就没有对应的头（RFC-005 §7.2）。
      for (const [name, value] of Object.entries(decision.injected.attributes)) c.header(name, value);
      c.header(IDENTITY_HEADERS.requestId, requestId(c));
      // 网关把本响应头复制进原请求：去掉平台会话 Cookie，业务服务拿不到会话令牌（Design §7.1）。
      c.header('cookie', withoutSessionCookie(c.req.header('cookie'), sessionCookieName));
      return c.body(null, 200);
    }
    case 'login-redirect':
      return c.redirect(decision.location, 302);
    case 'unauthenticated':
      return c.json({ error: 'unauthenticated', message: decision.message, details: {} }, 401);
    case 'forbidden':
      // 浏览器导航给人看的页面（原因＋返回工作台）；程序调用仍是 JSON。
      if ((c.req.header('accept') ?? '').includes('text/html')) return c.html(api.forbiddenPage(decision.message, { scheme: c.req.header('x-forwarded-proto') }), 403);
      return c.json({ error: 'forbidden', message: decision.message, details: {} }, 403);
    case 'no-app-access': {
      // 2026-09-24：正式地址按应用可见范围拦下。浏览器导航给平台统一的「没有项目权限」页，程序调用是 JSON；会话不清，人仍是登录的。
      const { denial } = decision, scheme = { scheme: c.req.header('x-forwarded-proto') };
      if ((c.req.header('accept') ?? '').includes('text/html')) return c.html(api.noAppAccessPage(denial, scheme), 403);
      return c.json({ error: 'forbidden', message: `没有应用「${denial.appName}」的使用权限`, details: { reason: 'app-access', projectId: denial.projectId, requestable: denial.requestable } }, 403);
    }
    case 'unavailable':
      return unavailableResponse(c, decision.entry, api);
  }
}

/**
 * RFC-021：正式版本维护中是 503，有预计恢复时间时带 Retry-After。待命槽上没有版本的未部署页已退役（RFC-025 I26 裁定）：
 * 槽「已结束」时路由改指 cs-api 的说明页，错误体仍是 `not-deployed`＋`details`。
 */
function unavailableResponse(c: Context<AppEnv>, entry: Extract<UserAuthDecision, { kind: 'unavailable' }>['entry'], api: IdentityModuleApi): Response {
  if (entry.retryAfterSeconds) c.header('retry-after', String(entry.retryAfterSeconds));
  if ((c.req.header('accept') ?? '').includes('text/html')) return c.html(api.unavailablePage(entry, { scheme: c.req.header('x-forwarded-proto') }), 503);
  return c.json({ error: 'maintenance', message: `${entry.projectSlug} 正在维护：${entry.reason}`, details: { reason: entry.reason, ...(entry.expectedEndAt ? { expectedEndAt: entry.expectedEndAt } : {}) } }, 503);
}

function serviceResponse(c: Context<AppEnv>, decision: ServiceAuthDecision): Response {
  if (decision.kind === 'unavailable') {
    if (decision.retryAfterSeconds) c.header('retry-after', String(decision.retryAfterSeconds));
    return c.json({ error: 'maintenance', message: decision.message, details: {} }, 503);
  }
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

function withoutSessionCookie(header: string | undefined, name: string): string {
  return (header ?? '').split(';').map((part) => part.trim()).filter((part) => part && !part.startsWith(`${name}=`)).join('; ');
}
