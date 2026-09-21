import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { readAllowlistFacts, readServiceRoutes } from '../features/admin/model/gatewayStatus';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

const ROUTE = { host: 'demo.cs.localhost', pathPrefix: '/api', domain: 'user' as const, kind: 'prod' as const, target: { namespace: 'cs-demo', service: 'demo-prod', port: 8080 }, middlewares: ['forward-auth'] };
const ALLOWLIST = { identityVersion: 2, operationRoutes: [], version: 7, generatedAt: '2026-09-21T01:00:00.000Z', defaultOpen: ['01a0bf5d-8f4b-7735-8981-22e6031d8202'], entries: [{ caller: {}, operations: [] }, { caller: {}, operations: [] }], maxStaleSeconds: 300 };

interface Stub { routes?: unknown; routesStatus?: number; allowlist?: unknown; allowlistStatus?: number }

/** 桩记录每次调用；503、格式不合都是开关，随时可以拨回正常值来验证「重新读取」。 */
function fixture(initial: Stub = {}) {
  const state: Stub = { routes: { items: [{ serviceName: 'demo', routes: [ROUTE] }] }, allowlist: ALLOWLIST, ...initial };
  const calls: Array<{ method: string; path: string }> = [];
  globalThis.fetch = (async (raw: string | URL | Request, init?: RequestInit) => {
    const path = new URL(typeof raw === 'string' ? raw : raw instanceof URL ? raw.toString() : raw.url, 'http://localhost').pathname;
    calls.push({ method: init?.method ?? 'GET', path });
    let body: unknown = { items: [] }, status = 200;
    if (path.endsWith('/v1/me')) body = { id: 'user', name: '管理员', email: 'admin@example.invalid', platformRole: 'admin', isAdmin: true, memberships: [] };
    else if (path.endsWith('/v1/gateway/routes')) { status = state.routesStatus ?? 200; body = status === 200 ? state.routes : { error: 'unavailable', message: '路由表暂不可读' }; }
    else if (path.endsWith('/v1/gateway/allowlist')) { status = state.allowlistStatus ?? 200; body = status === 200 ? state.allowlist : { error: 'unavailable', message: '放行表暂不可读' }; }
    else if (path.endsWith('/v1/gateway/reconcile')) body = { routes: 4, allowlist: 8 };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { state, calls, reads: (suffix: string) => calls.filter((call) => call.method === 'GET' && call.path.endsWith(suffix)).length };
}

const navLinks = (): string[] => [...document.querySelectorAll('nav[aria-label="主导航"] ul a')].map((link) => link.textContent ?? '');
const fact = (label: string): string | undefined => [...document.querySelectorAll('main dl > div')].find((row) => row.querySelector('dt')?.textContent === label)?.querySelector('dd')?.textContent ?? undefined;

describe('网关状态页', () => {
  test('正常：放行表事实与路由表都来自真实响应', async () => {
    fixture(); page = await renderApp('/admin/gateway');
    expect(fact('放行表版本')).toBe('7');
    expect(fact('放行表条目')).toBe('2');
    expect(fact('默认开放操作')).toBe('1');
    expect(fact('失联容忍（秒）')).toBe('300');
    expect(fact('生成时间')).not.toBe('—');
    const cells = [...document.querySelectorAll('main tbody tr td')].map((cell) => cell.textContent);
    expect(cells).toEqual(['demo', 'demo.cs.localhost', '/api', '用户域', 'prod', 'cs-demo/demo-prod:8080', 'forward-auth']);
  });

  test('尚未生成放行表：版本 0，生成时间与失联容忍显示为「—」，路由表给空态', async () => {
    fixture({ allowlist: { version: 0, entries: [], defaultOpen: [] }, routes: { items: [] } }); page = await renderApp('/admin/gateway');
    expect(fact('放行表版本')).toBe('0');
    expect(fact('放行表条目')).toBe('0');
    expect(fact('生成时间')).toBe('—');
    expect(fact('失联容忍（秒）')).toBe('—');
    expect(page.text()).toContain('路由表是空的');
  });

  // 锁的真实故障（2026-09-21）：放行表响应缺 entries 时 GatewaySection 在渲染期抛 TypeError，
  // 工作台又没有任何路由级错误边界，于是整个应用（顶栏、左栏）被换成一句英文的 Something went wrong。
  test('放行表响应格式不合：页面不崩，说明原因，不伪造 0 条，重新读取后恢复', async () => {
    const stub = fixture({ allowlist: { items: [] } }); page = await renderApp('/admin/gateway');
    expect(navLinks()).toContain('网关');
    expect(page.text()).toContain('放行表的响应格式不符合预期');
    expect(fact('放行表条目')).toBeUndefined();
    // 路由表是独立读取，照常可用；重算用于状态漂移后的对齐，读失败时更不能藏起来。
    expect(page.text()).toContain('demo.cs.localhost');
    expect(page.text()).toContain('重算路由与放行表');
    stub.state.allowlist = ALLOWLIST;
    await page.click('重新读取');
    expect(fact('放行表条目')).toBe('2');
    expect(page.text()).not.toContain('放行表的响应格式不符合预期');
  });

  test('放行表读取失败：显示服务端原因而不是 0 条，路由表不受影响', async () => {
    const stub = fixture({ allowlistStatus: 503 }); page = await renderApp('/admin/gateway');
    expect(page.text()).toContain('放行表暂不可读');
    expect(fact('放行表条目')).toBeUndefined();
    expect(page.text()).toContain('demo.cs.localhost');
    stub.state.allowlistStatus = 200;
    await page.click('重新读取');
    expect(fact('放行表版本')).toBe('7');
    expect(stub.reads('/v1/gateway/allowlist')).toBe(2);
  });

  test('路由表响应格式不合或读取失败：不崩，说明原因，放行表事实照常', async () => {
    const stub = fixture({ routes: { items: [{ serviceName: 'demo', routes: [{ host: 'demo.cs.localhost' }] }] } }); page = await renderApp('/admin/gateway');
    expect(navLinks()).toContain('网关');
    expect(page.text()).toContain('路由表的响应格式不符合预期');
    expect(page.text()).not.toContain('路由表是空的');
    expect(fact('放行表版本')).toBe('7');
    stub.state.routes = undefined; stub.state.routesStatus = 503;
    await page.click('重新读取');
    expect(page.text()).toContain('路由表暂不可读');
    expect(page.text()).not.toContain('路由表是空的');
  });

  test('重算：发出一次 POST，显示结果，并重新读取两张表', async () => {
    const stub = fixture(); page = await renderApp('/admin/gateway');
    await page.click('重算路由与放行表');
    expect(stub.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/v1/gateway/reconcile'))).toHaveLength(1);
    expect(page.text()).toContain('已重算 4 条路由，放行表版本 8。');
    expect(stub.reads('/v1/gateway/routes')).toBe(2);
    expect(stub.reads('/v1/gateway/allowlist')).toBe(2);
  });
});

describe('网关响应的形状检查', () => {
  test('放行表：只检查页面要读的字段，条目内容不逐项校验', () => {
    // 库里可能还留着旧版本生成的文档；页面只数条目数，为一条旧格式条目把整张卡片判成错误没有意义。
    expect(readAllowlistFacts({ version: 3, entries: [{ legacy: true }], defaultOpen: [] })).toEqual({ version: 3, entries: 1, defaultOpen: 0, generatedAt: undefined, maxStaleSeconds: undefined });
    for (const broken of [null, undefined, 'text', [], { items: [] }, { version: '3', entries: [], defaultOpen: [] }, { version: 3, entries: {}, defaultOpen: [] }, { version: 3, entries: [], defaultOpen: [], generatedAt: 5 }, { version: 3, entries: [], defaultOpen: [], maxStaleSeconds: '300' }]) {
      expect(readAllowlistFacts(broken)).toBeUndefined();
    }
  });

  test('路由表：条目按契约解析，缺省的中间件补成空数组；任何一条不合就整体判为不合', () => {
    const { middlewares: _dropped, ...bare } = ROUTE;
    expect(readServiceRoutes({ items: [{ serviceName: 'demo', routes: [bare] }] })).toEqual([{ serviceName: 'demo', routes: [{ ...bare, middlewares: [] }] }]);
    expect(readServiceRoutes({ items: [] })).toEqual([]);
    for (const broken of [null, {}, { items: {} }, { items: [null] }, { items: [{ serviceName: 5, routes: [] }] }, { items: [{ serviceName: 'demo', routes: {} }] }, { items: [{ serviceName: 'demo', routes: [{ ...ROUTE, target: undefined }] }] }, { items: [{ serviceName: 'demo', routes: [{ ...ROUTE, kind: 'unknown-kind' }] }] }]) {
      expect(readServiceRoutes(broken)).toBeUndefined();
    }
  });
});
