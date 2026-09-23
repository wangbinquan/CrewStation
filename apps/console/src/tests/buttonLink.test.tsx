import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { Button } from '../shared/ui/Button';
import { ButtonLink, ExternalButtonLink } from '../shared/ui/navigation/ButtonLink';
import { consoleStyles, sourceAt } from './sourceScan';
import { renderElement } from './renderElement';

let rendered: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { rendered?.unmount(); rendered = undefined; });

/** `to` 受生产路由树的类型约束，小路由树借用几条真实存在的路径。 */
function Page() {
  return <>
    <ButtonLink variant="primary" to="/admin/requests" search={{ state: 'pending' }}>去审批</ButtonLink>
    <ButtonLink size="small" to="/admin/gateway">网关</ButtonLink>
    <ExternalButtonLink size="small" href="//formal.test">打开正式应用</ExternalButtonLink>
    <Button size="small">同尺寸的按钮</Button>
  </>;
}

async function render() {
  const root = createRootRoute({ component: Outlet });
  const page = createRoute({ getParentRoute: () => root, path: '/admin', component: Page });
  const requests = createRoute({ getParentRoute: () => root, path: '/admin/requests', component: () => <p>审批列表</p> });
  const gateway = createRoute({ getParentRoute: () => root, path: '/admin/gateway', component: () => <p>网关页</p> });
  const router = createRouter({ routeTree: root.addChildren([page, requests, gateway]), history: createMemoryHistory({ initialEntries: ['/admin'] }) });
  rendered = await renderElement(<RouterProvider router={router} />, {});
  return router;
}

const anchor = (label: string) => [...rendered!.host.querySelectorAll('a')].find((node) => node.textContent === label)!;

// 2026-09-23 裁定：动作型跳转做成按钮样子，但仍是真正的链接——能新标签页打开、能复制地址、读屏报为链接。
test('按钮样式链接：仍是带真实地址的 <a>，外观与同档位按钮一致，点击走路由', async () => {
  const router = await render();
  const approve = anchor('去审批');
  expect(approve.getAttribute('href')).toBe('/admin/requests?state=pending');
  expect(approve.className.split(' ')).toEqual(['button', 'primary']);
  expect(approve.hasAttribute('data-button')).toBe(true);
  const small = anchor('网关'), button = [...rendered!.host.querySelectorAll('button')].find((node) => node.textContent === '同尺寸的按钮')!;
  expect(small.className).toBe(button.className);
  expect(small.getAttribute('target')).toBeNull();
  await act(async () => approve.click()); await rendered!.settle();
  expect(router.state.location.pathname).toBe('/admin/requests');
  expect(rendered!.host.textContent).toContain('审批列表');
});

test('外部地址：新窗口打开且不带来源，↗ 由样式生成、不进链接文字', async () => {
  await render();
  const external = anchor('打开正式应用');
  expect(external.getAttribute('href')).toBe('//formal.test');
  expect(external.getAttribute('target')).toBe('_blank');
  expect(external.getAttribute('rel')).toBe('noreferrer');
  expect(external.className.split(' ')).toEqual(['button', 'secondary', 'small', 'external']);
  const css = sourceAt(consoleStyles(), 'shared/ui/Button.module.css').code;
  expect(css).toMatch(/\.external::after \{[^}]*content: '↗' \/ '';/);
  // 全局 a:hover 会给链接加下划线；按钮样式链接必须自己关掉。
  expect(css).toMatch(/\.button:hover \{\s*text-decoration: none;/);
});
