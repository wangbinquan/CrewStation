import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act } from 'react';
import { ProjectNavSection } from '../app/layout/ProjectNavSection';
import { messages as projects } from '../features/projects/i18n/zh-CN';
import { messages as observability } from '../features/observability/i18n/zh-CN';
import { messages as resources } from '../features/project-resources/i18n/zh-CN';
import type { ProjectSpace } from '../shared/project/projectPaths';
import { projectCreationFixture, creationProjectId } from './projectCreationFixture';
import { renderElement } from './renderElement';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

async function renderNavigation(path: string, space: ProjectSpace = 'workbench') {
  const root = createRootRoute({ component: () => <ProjectNavSection projectId={creationProjectId} space={space} /> });
  const routeTree = root.addChildren([createRoute({ getParentRoute: () => root, path: '$' })]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  page = await renderElement(<RouterProvider router={router} />, { ...projects, ...observability, ...resources });
  return router;
}

test('项目导航不常驻首次交付；主流程与运行管理分层，从引导点击开发回到 CLI', async () => {
  const fixture = projectCreationFixture('developer');
  const router = await renderNavigation(`/projects/${creationProjectId}/dev-session?view=guided`);
  const navigation = page!.host.querySelector('[aria-label="项目页面"]')!;
  // 首次交付曾被加成永久页签，分组又被放到项目页面列表外；只保留日常入口与从属管理入口。
  expect(navigation.textContent).not.toContain('首次交付');
  expect([...navigation.querySelectorAll(':scope > li > a')].map(node => node.textContent)).toEqual(['概览', '开发', '发布与上线']);
  const group = navigation.querySelector('details')!;
  expect(group.open).toBe(false);
  expect(group.querySelector('summary')?.textContent).toBe('运行与管理');
  expect([...group.querySelectorAll('a')].map(node => node.textContent)).toEqual(['运行与诊断', '运行观测与统计', '项目资源中心', '项目设置']);
  await act(async () => { navigation.querySelector<HTMLAnchorElement>('a[href*="/dev-session"]')!.click(); });
  await page!.settle();
  expect(router.state.location.pathname).toBe(`/projects/${creationProjectId}/dev-session`);
  // 日常开发入口曾强制带 guided，已有用户点「开发」也被切到新手页面。
  expect(router.state.location.search).toMatchObject({ view: 'cli' });
  expect(fixture.writes()).toHaveLength(0);
});

test.each(['workbench', 'admin'] as const)('%s 的运行管理深链接自动展开，并保留当前页面高亮', async (space) => {
  projectCreationFixture(space === 'admin' ? 'admin' : 'developer');
  const base = `${space === 'admin' ? '/admin/integrations' : '/projects'}/${creationProjectId}`;
  await renderNavigation(`${base}/observability?period=7d`, space);
  const group = page!.host.querySelector('details')!;
  expect(group.open).toBe(true);
  expect(group.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe(`${base}/observability`);
  const navigation = page!.host.querySelector('[aria-label="项目页面"]')!;
  expect(navigation.contains(group)).toBe(true);
  expect([...navigation.querySelectorAll('a')].every(node => node.getAttribute('href')?.startsWith(base))).toBe(true);
});

test('试用身份只看到预览，不展示开发和运行管理入口', async () => {
  projectCreationFixture('developer');
  const fixtureFetch = globalThis.fetch;
  globalThis.fetch = (async (raw, init) => String(raw).endsWith('/v1/me')
    ? Response.json({ id: 'preview-user', name: '试用成员', platformRole: 'developer', isAdmin: false, memberships: [{ projectId: creationProjectId, role: 'tester' }] })
    : fixtureFetch(raw, init)) as typeof fetch;
  await renderNavigation(`/projects/${creationProjectId}`);
  expect([...page!.host.querySelectorAll('a')].map(node => node.textContent)).toEqual(['版本试用']);
  expect(page!.host.querySelector('details')).toBeNull();
});
