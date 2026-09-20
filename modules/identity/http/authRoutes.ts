import { PLATFORM_PATHS } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { isPlatformError, validation } from '@crewstation/kernel';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { IdentityModuleApi, LoginInput, SessionCookieSpec } from '../api/moduleApi';

/**
 * 登录、引导、OIDC、登出、状态与 JWKS。全部在网关免鉴权的 `/auth` 前缀内（deploy 40-gateway.yaml）。
 * 浏览器路径一律返回页面，程序路径（Accept: application/json）返回 JSON。
 */
export function authRoutes(api: IdentityModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get(PLATFORM_PATHS.jwks, async (c) => {
    c.header('cache-control', 'public, max-age=300');
    return c.json(await api.jwks());
  });
  r.get('/auth/status', async (c) => c.json(await api.loginMethods()));

  r.get('/auth/login', async (c) => c.html(await api.loginPageHtml(c.req.query('returnTo'), scheme(c), undefined, c.req.query('setup') === 'complete')));
  r.post('/auth/login', async (c) => {
    const input = await loginInput(c);
    try {
      const result = await api.passwordLogin(input, scheme(c));
      writeSessionCookie(c, api.sessionCookie, result.session.token);
      if (wantsJson(c)) return c.json({ user: result.user, returnTo: result.returnTo });
      return c.redirect(result.returnTo, 302);
    } catch (error) {
      // 表单提交要把原因显示在登录页上；JSON 调用方仍然拿到结构化错误。
      if (wantsJson(c) || !isPlatformError(error)) throw error;
      const returnTo = typeof input.returnTo === 'string' ? input.returnTo : undefined;
      return c.html(await api.loginPageHtml(returnTo, scheme(c), error.message), statusOf(error));
    }
  });

  r.get('/auth/bootstrap', async (c) => {
    if (!(await api.bootstrapStatus()).required) return c.redirect('/auth/login', 302);
    return c.html(api.bootstrapPageHtml(undefined, { returnTo: c.req.query('returnTo') }));
  });
  r.post('/auth/bootstrap', async (c) => {
    const input = await loginInput(c);
    try {
      const admin = await api.bootstrapAdmin(input);
      if (wantsJson(c)) return c.json({ user: admin });
      // 不返回管理员会话：引导令牌的失效点就是这次提交，接下来必须用刚创建的账户正常登录一次。
      const redirect = new URLSearchParams({ setup: 'complete' });
      if (typeof input.returnTo === 'string' && input.returnTo) redirect.set('returnTo', input.returnTo);
      return c.redirect(`/auth/login?${redirect}`, 302);
    } catch (error) {
      if (wantsJson(c) || !isPlatformError(error)) throw error;
      if (error.details.code === 'bootstrap-already-complete') return c.html(await api.loginPageHtml(undefined, scheme(c), error.message), 409);
      return c.html(api.bootstrapPageHtml(error.message, input), statusOf(error));
    }
  });

  r.get('/auth/oidc/:slug/start', async (c) => {
    const { location } = await api.startOidcLogin(c.req.param('slug'), c.req.query('returnTo'), scheme(c));
    return c.redirect(location, 302);
  });
  r.get('/auth/oidc/:slug/callback', async (c) => {
    const outcome = await api.completeOidcLogin({ code: c.req.query('code'), state: c.req.query('state') });
    if (outcome.kind === 'failed') return c.html(api.loginErrorPageHtml(outcome.code), 400);
    writeSessionCookie(c, api.sessionCookie, outcome.session.token);
    return c.redirect(outcome.returnTo, 302);
  });

  r.on(['GET', 'POST'], '/auth/logout', (c) => {
    deleteCookie(c, api.sessionCookie.name, { domain: api.sessionCookie.domain, path: api.sessionCookie.path });
    return c.redirect(api.logoutRedirect(c.req.query('returnTo'), scheme(c)), 302);
  });
  return r;
}

export function writeSessionCookie(c: Context<AppEnv>, spec: SessionCookieSpec, token: string): void {
  setCookie(c, spec.name, token, { domain: spec.domain, path: spec.path, httpOnly: spec.httpOnly, sameSite: spec.sameSite, secure: spec.secure, maxAge: spec.maxAgeSeconds });
}

function scheme(c: Context<AppEnv>): { scheme?: string } {
  const forwarded = c.req.header('x-forwarded-proto');
  return forwarded === undefined ? {} : { scheme: forwarded };
}

/** 表单（浏览器）或 JSON（测试与 CLI）两种提交；字段原样交给用例按契约校验。 */
async function loginInput(c: Context<AppEnv>): Promise<LoginInput> {
  if ((c.req.header('content-type') ?? '').includes('application/json')) {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validation('请求体必须是 JSON');
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw validation('登录参数必须是 JSON 对象');
    return raw as LoginInput;
  }
  const body = await c.req.parseBody();
  return Object.fromEntries(Object.entries(body).filter(([, value]) => typeof value === 'string'));
}

function wantsJson(c: Context<AppEnv>): boolean {
  const accept = c.req.header('accept') ?? '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

function statusOf(error: { kind: string }): 400 | 401 | 403 | 409 {
  switch (error.kind) {
    case 'unauthenticated': return 401;
    case 'forbidden': return 403;
    case 'conflict': return 409;
    default: return 400;
  }
}
