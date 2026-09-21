import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { messages as appEn } from '../app/i18n/en-US';
import { messages as appZh } from '../app/i18n/zh-CN';
import { messages as adminEn } from '../features/admin/i18n/en-US';
import { messages as adminZh } from '../features/admin/i18n/zh-CN';
import { messages as clusterEn } from '../features/cluster/i18n/en-US';
import { messages as clusterZh } from '../features/cluster/i18n/zh-CN';
import { ADMIN_ENTRY_GROUPS, ADMIN_PENDING_PAGES } from '../shared/admin/adminNavigation';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
const projectId = '01a0bf5d-8f4b-7148-804c-6bd655d243f6', serviceId = '01a0bf5d-8f4b-76be-8473-58312e41bdd7';
const project = { id: projectId, serviceId, name: '公司接口接入', slug: 'company-api', kind: 'APIProxy', state: 'active', namespace: 'cs-company-api', createdAt: '2026-09-13T01:00:00.000Z' };
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function asAdmin(): void {
  globalThis.fetch = (async (raw: string | URL | Request) => {
    const url = typeof raw === 'string' ? raw : raw instanceof URL ? raw.toString() : raw.url;
    let body: unknown = { items: [] }, status = 200;
    if (url.endsWith('/v1/me')) body = { id: 'user', name: '管理员', email: 'admin@example.invalid', platformRole: 'admin', isAdmin: true, memberships: [] };
    else if (url.endsWith(`/v1/projects/${projectId}`)) body = project;
    else if (url.endsWith(`/v1/services/${serviceId}`)) body = { id: serviceId, projectId };
    else if (url.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '当前没有开发会话' }; }
    else if (url.endsWith('/v1/gateway/allowlist')) body = { version: 3, entries: [], defaultOpen: [], generatedAt: '2026-09-21T01:00:00.000Z', maxStaleSeconds: 60 };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

interface RenderedGroup { readonly title: string | null; readonly pages: readonly string[] }

/** 按结构读树：每个 ul 是一组，紧挨在它前面的元素是组标题；不依赖类名。 */
function linkTree(root: Element | null): RenderedGroup[] {
  if (root === null) throw new Error('找不到管理左栏');
  return [...root.querySelectorAll('ul')].map((list) => ({
    title: list.previousElementSibling?.textContent ?? null,
    pages: [...list.querySelectorAll('a')].map((link) => link.textContent ?? ''),
  }));
}

const EXPECTED_TREE: readonly RenderedGroup[] = [
  { title: null, pages: ['总览', '申请审批'] },
  { title: '运行与观测', pages: ['集群管理', '网关'] },
  { title: '供给与接入', pages: ['项目管理', '能力接入'] },
  { title: '身份与访问', pages: ['用户与权限', '认证'] },
  { title: '资源与网络', pages: ['算力档位', '出站白名单'] },
];

describe('管理空间的分组树（2026-09-21 修订 RFC-003 §4）', () => {
  // 锁的是作者反馈的真实问题：集群管理、网关是看运行状态的呈现类页面，曾和六个配置页一起挂在「平台设置」下。
  // 这里同时锁分组、组序与组内顺序；谁把呈现类页面挪回配置分组，这条就红。
  test('左栏：待处理 → 运行与观测 → 供给与接入 → 身份与访问 → 资源与网络', async () => {
    asAdmin(); page = await renderApp('/admin');
    expect(linkTree(document.querySelector('nav[aria-label="主导航"]'))).toEqual([...EXPECTED_TREE]);
    expect(page.text()).not.toContain('平台设置');
  });

  test('左栏每一项都是独立 URL，点击后落在对应页面并标为当前页', async () => {
    asAdmin(); page = await renderApp('/admin');
    const hrefs = [...document.querySelectorAll('nav[aria-label="主导航"] ul a')].map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([...ADMIN_PENDING_PAGES, ...ADMIN_ENTRY_GROUPS.flatMap((group) => group.pages)].map((item) => item.to));
    await page.click('网关');
    expect(page.path()).toBe('/admin/gateway');
    const current = [...document.querySelectorAll('nav[aria-label="主导航"] ul a')].filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.textContent);
    // 总览用精确匹配，进入子页后不再跟着亮。
    expect(current).toEqual(['网关']);
  });

  test('接入容器项目内折叠的平台菜单是同一棵树', async () => {
    asAdmin(); page = await renderApp(`/admin/integrations/${projectId}`);
    expect(document.querySelector('nav details summary')?.textContent).toBe('平台管理');
    expect(linkTree(document.querySelector('nav details'))).toEqual([...EXPECTED_TREE]);
  });

  test('总览入口卡片按同样的分组显示，补齐认证与集群管理，不重复待处理入口', async () => {
    asAdmin(); page = await renderApp('/admin');
    const sections = [...document.querySelectorAll('main section[aria-labelledby^="admin-entries-"]')];
    const rendered = sections.map((section) => ({
      title: document.getElementById(section.getAttribute('aria-labelledby')!)?.textContent ?? null,
      // 组标题是 section 的直接子元素，卡片标题在各自的卡片里。
      pages: [...section.querySelectorAll('h2')].filter((heading) => heading.parentElement !== section).map((heading) => heading.textContent ?? ''),
      links: [...section.querySelectorAll('a')].map((link) => `${link.textContent} → ${link.getAttribute('href')}`),
    }));
    expect(rendered.map(({ title, pages }) => ({ title, pages }))).toEqual(EXPECTED_TREE.slice(1).map((group) => ({ title: group.title, pages: [...group.pages] })));
    expect(rendered.flatMap((group) => group.links)).toEqual(ADMIN_ENTRY_GROUPS.flatMap((group) => group.pages).map((item) => `打开${zh[item.labelKey]} → ${item.to}`));
    // 此前缺的两张卡片，带各自页面的用途说明。
    expect(page.text()).toContain(zh['admin.auth.pageHint']!);
    expect(page.text()).toContain(zh['cluster.description']!);
    // 申请审批由上方「待处理事项」的两个入口承担，入口卡片区不再重复。
    expect(page.text()).toContain('待处理事项');
    expect(page.text()).not.toContain('打开申请审批');
    expect(page.text()).not.toContain('打开总览');
  });
});

const zh: Record<string, string> = { ...appZh, ...adminZh, ...clusterZh };
const en: Record<string, string> = { ...appEn, ...adminEn, ...clusterEn };

describe('分组定义本身', () => {
  test('每个管理页只登记一次，每组都有页面', () => {
    const paths = [...ADMIN_PENDING_PAGES, ...ADMIN_ENTRY_GROUPS.flatMap((group) => group.pages)].map((item) => item.to);
    expect(new Set(paths).size).toBe(paths.length);
    expect(ADMIN_ENTRY_GROUPS.filter((group) => group.pages.length === 0).map((group) => group.id)).toEqual([]);
    expect(new Set(ADMIN_ENTRY_GROUPS.map((group) => group.id)).size).toBe(ADMIN_ENTRY_GROUPS.length);
  });

  // 渲染用例把 en-US 也映射到中文文案，英文漏键不会红；这里直接对两份文案查键。
  test('标题、页面名与用途说明的文案键中英文都存在', () => {
    const keys = [
      ...ADMIN_PENDING_PAGES.map((item) => item.labelKey),
      ...ADMIN_ENTRY_GROUPS.flatMap((group) => [group.titleKey, ...group.pages.flatMap((item) => [item.labelKey, item.hintKey])]),
    ];
    expect({ 中文缺少: keys.filter((key) => !zh[key]), 英文缺少: keys.filter((key) => !en[key]) }).toEqual({ 中文缺少: [], 英文缺少: [] });
    expect(en['nav.admin.groupObservability']).toBe('Runtime and observability');
    expect(zh['nav.admin.groupSettings']).toBeUndefined();
    expect(en['nav.admin.groupSettings']).toBeUndefined();
  });
});
