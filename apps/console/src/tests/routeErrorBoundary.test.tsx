import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from '@tanstack/react-router';
import { RouteErrorPanel } from '../app/router/RouteErrorPanel';
import { router as productionRouter } from '../app/router/router';
import { useApiQuery } from '../shared/api/useApi';
import { renderElement } from './renderElement';

const originalFetch = globalThis.fetch;
let rendered: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { rendered?.unmount(); rendered = undefined; globalThis.fetch = originalFetch; });

/** Link 的 `to` 受生产路由树的类型约束，小路由树因此借用两条真实存在的路径：出错页是网关，另一页是总览。 */
function Shell() { return <><nav aria-label="外壳导航"><Link to="/admin">另一页</Link><Link to="/admin/gateway">出错页</Link></nav><main><Outlet /></main></>; }
/** 真实故障的形状：响应缺字段，页面在渲染期解引用它。 */
function Boom() {
  const report = useApiQuery(['boom'], async () => (await fetch('/v1/boom')).json() as Promise<{ entries: unknown[] }>);
  return report.data ? <p>共 {report.data.entries.length} 条</p> : <p>载入中</p>;
}

async function fixture(useDefaultErrorComponent: boolean) {
  const state = { body: {} as unknown, reads: 0 };
  globalThis.fetch = (async (_input: string | URL | Request) => { state.reads += 1; return new Response(JSON.stringify(state.body), { headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
  const root = createRootRoute({ component: Outlet });
  const shell = createRoute({ getParentRoute: () => root, id: 'shell', component: Shell });
  const boom = createRoute({ getParentRoute: () => shell, path: '/admin/gateway', component: Boom });
  const fine = createRoute({ getParentRoute: () => shell, path: '/admin', component: () => <p>另一页的内容</p> });
  const router = createRouter({ routeTree: root.addChildren([shell.addChildren([boom, fine])]), history: createMemoryHistory({ initialEntries: ['/admin/gateway'] }), ...(useDefaultErrorComponent ? { defaultErrorComponent: RouteErrorPanel } : {}) });
  rendered = await renderElement(<RouterProvider router={router} />, {});
  return { state, router };
}

describe('路由的默认错误面板', () => {
  // 锁的真实故障（2026-09-21 网关页实撞）：工作台没有任何路由级错误边界，一个页面在渲染期抛错，
  // 异常一路冒到根上，顶栏、左栏连同页面一起被路由库自带的英文默认页顶掉。
  test('没有默认错误面板时，一页出错整个外壳都没了——这是要防的形态', async () => {
    await fixture(false);
    expect(rendered!.text()).toContain('Something went wrong');
    expect(document.querySelector('nav[aria-label="外壳导航"]')).toBeNull();
  });

  test('页面渲染期抛错：外壳与导航留着，就地给出中文原因，可以走到别的页面', async () => {
    const f = await fixture(true);
    expect(document.querySelector('nav[aria-label="外壳导航"]')).not.toBeNull();
    expect(rendered!.text()).not.toContain('Something went wrong');
    expect(document.querySelector('main [role="alert"]')?.textContent).toContain('这个页面显示时出错');
    expect(document.querySelector('main [role="alert"]')?.textContent).toContain('entries');
    await act(async () => { document.querySelector<HTMLAnchorElement>('a[href="/admin"]')!.click(); }); await rendered!.settle();
    expect(f.router.state.location.pathname).toBe('/admin');
    expect(rendered!.text()).toContain('另一页的内容');
    expect(document.querySelector('main [role="alert"]')).toBeNull();
  });

  test('重试会丢掉让页面崩掉的那份缓存重新读取：仍是坏数据就仍然就地报错，数据好了就恢复', async () => {
    const f = await fixture(true);
    expect(f.state.reads).toBe(1);
    await rendered!.click('重试');
    expect(f.state.reads).toBe(2);
    expect(document.querySelector('main [role="alert"]')?.textContent).toContain('这个页面显示时出错');
    expect(document.querySelector('nav[aria-label="外壳导航"]')).not.toBeNull();
    f.state.body = { entries: [1, 2, 3] };
    await rendered!.click('重试');
    expect(f.state.reads).toBe(3);
    expect(rendered!.text()).toContain('共 3 条');
    expect(document.querySelector('main [role="alert"]')).toBeNull();
  });

  test('生产路由与整页旅程用例都接上了这块面板', () => {
    // 加载真正的生产路由器来核对，而不是只读源码文本：新增代码防护也要求改到的生产文件被用例加载。
    expect(productionRouter.options.defaultErrorComponent).toBe(RouteErrorPanel);
    // renderApp 自己建路由；不同步这一项，整页旅程用例看到的出错形态就和生产不一样。
    expect(readFileSync(join(import.meta.dir, 'renderApp.tsx'), 'utf8')).toContain('defaultErrorComponent: RouteErrorPanel');
  });
});
