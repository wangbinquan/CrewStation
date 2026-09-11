import { PLATFORM_PATHS } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { PlatformError, validation } from '@crewstation/kernel';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { IdentityModuleApi, LoginInput, SessionCookieSpec } from '../api/moduleApi';

/** 登录、登出、状态与 JWKS。未配置登录适配器时 /auth/* 一律 503，JWKS 不受影响。 */
export function authRoutes(api: IdentityModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get(PLATFORM_PATHS.jwks, async (c) => {
    c.header('cache-control', 'public, max-age=300');
    return c.json(await api.jwks());
  });
  if (api.providerKind === undefined) {
    r.all('/auth/*', () => {
      throw new PlatformError('unavailable', '未配置身份提供者');
    });
    return r;
  }
  r.get('/auth/status', (c) => c.json(api.authStatus()));
  r.get('/auth/login', async (c) => {
    const page = await api.loginPage(c.req.query('returnTo'), { scheme: c.req.header('x-forwarded-proto') });
    return page.kind === 'html' ? c.html(page.html) : c.redirect(page.location, 302);
  });
  r.post('/auth/login', async (c) => {
    const result = await api.login(await loginInput(c), { scheme: c.req.header('x-forwarded-proto') });
    writeSessionCookie(c, api.sessionCookie, result.session.token);
    if (wantsJson(c)) return c.json({ user: result.user, returnTo: result.returnTo });
    return c.redirect(result.returnTo, 302);
  });
  r.on(['GET', 'POST'], '/auth/logout', (c) => {
    deleteCookie(c, api.sessionCookie.name, { domain: api.sessionCookie.domain, path: api.sessionCookie.path });
    return c.redirect(api.logoutRedirect(c.req.query('returnTo'), { scheme: c.req.header('x-forwarded-proto') }), 302);
  });
  return r;
}

export function writeSessionCookie(c: Context<AppEnv>, spec: SessionCookieSpec, token: string): void {
  setCookie(c, spec.name, token, { domain: spec.domain, path: spec.path, httpOnly: spec.httpOnly, sameSite: spec.sameSite, secure: spec.secure, maxAge: spec.maxAgeSeconds });
}

/** 表单（浏览器）或 JSON（测试与 CLI）两种提交；字段原样交给适配器校验。 */
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
