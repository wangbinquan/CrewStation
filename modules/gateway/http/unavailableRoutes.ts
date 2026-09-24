import type { AppEnv } from '@crewstation/http';
import { Hono } from 'hono';
import type { NotDeployedEntry } from '../api/moduleApi';
import { UNAVAILABLE_PATH } from '../api/moduleApi';
import { notDeployedBody } from '../application/unavailable';

/** 说明页的渲染（identity 的页面，与维护页同源）：由组合根接上。 */
export type UnavailablePage = (entry: NotDeployedEntry, context: { readonly scheme?: string }) => string;

/**
 * 说明页（RFC-025 设计 §7.2，D13）：调和器把「已结束」的槽上的待验证与正式路由改指这里（ForwardAuth 之后，登录与试用权限照旧先过）。
 * 浏览器得到页面，接口请求得到 503＋`not-deployed`；一律不缓存——重新部署后刷新就该看到应用。刚部署好、路由还没改回来时带 `Retry-After`。
 */
export function unavailableRoutes(explain: (routeId: string, host: string | undefined) => Promise<NotDeployedEntry | undefined>, page: UnavailablePage): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.all(`${UNAVAILABLE_PATH}/:routeId`, async (c) => {
    const entry = await explain(c.req.param('routeId'), c.req.header('host'));
    c.header('cache-control', 'no-store');
    if (!entry) return c.json({ error: 'not_found', message: '没有这个说明页', details: {} }, 404);
    if (entry.recovering) c.header('retry-after', '2');
    if ((c.req.header('accept') ?? '').includes('text/html')) return c.html(page(entry, { ...(c.req.header('x-forwarded-proto') ? { scheme: c.req.header('x-forwarded-proto') } : {}) }), 503);
    return c.json(notDeployedBody(entry), 503);
  });
  return r;
}
