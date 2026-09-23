import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import type { RouterHistory } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RouteErrorPanel } from '../app/router/RouteErrorPanel';
import { routeTree } from '../app/router/routeTree';
import { messages as appZh } from '../app/i18n/zh-CN';
import { messages as adminZh } from '../features/admin/i18n/zh-CN';
import { messages as projectsZh } from '../features/projects/i18n/zh-CN';
import { messages as releaseZh } from '../features/release/i18n/zh-CN';
import { messages as devSessionZh } from '../features/dev-session/i18n/zh-CN';
import { messages as capabilitiesZh } from '../features/capabilities/i18n/zh-CN';
import { messages as catalogZh } from '../features/catalog/i18n/zh-CN';
import { messages as configZh } from '../features/config/i18n/zh-CN';
import { messages as logsZh } from '../features/logs/i18n/zh-CN';
import { messages as clusterZh } from '../features/cluster/i18n/zh-CN';
import { messages as eventsZh } from '../features/events/i18n/zh-CN';
import { messages as tracesZh } from '../features/traces/i18n/zh-CN';
import { I18nProvider } from '../shared/lib/I18nProvider';
import { mergeMessages } from '../shared/lib/i18n';
import type { MessageCatalog } from '../shared/lib/i18n';
import { interactiveScope } from './interactiveScope';

/**
 * 测试用文案目录：生产走 `import.meta.glob`（Vite 编译期收集），bun test 里没有这个能力，
 * 因此显式列出测试会渲染到的 feature。缺哪一份，断言会在文案上直接失败。
 */
const zh = mergeMessages([
  { source: 'app', messages: appZh },
  { source: 'admin', messages: adminZh },
  { source: 'projects', messages: projectsZh },
  { source: 'release', messages: releaseZh },
  { source: 'devSession', messages: devSessionZh },
  { source: 'capabilities', messages: capabilitiesZh },
  { source: 'events', messages: eventsZh },
  { source: 'logs', messages: logsZh },
  { source: 'config', messages: configZh },
  { source: 'catalog', messages: catalogZh },
  { source: 'cluster', messages: clusterZh },
  { source: 'traces', messages: tracesZh },
]);
const catalog: MessageCatalog = { 'zh-CN': zh, 'en-US': zh };

export interface RenderedApp {
  readonly text: () => string;
  readonly html: () => string;
  readonly path: () => string;
  readonly search: () => Record<string, unknown>;
  readonly back: () => Promise<void>;
  readonly navigate: (href: string) => Promise<void>;
  /** 发起导航并返回当前渲染，用于需要用户先回应应用内草稿确认的路径。 */
  readonly requestNavigate: (href: string) => Promise<void>;
  /** 点击第一个文本匹配的按钮或链接；找不到就抛，免得断言在「什么都没发生」上通过。 */
  readonly click: (label: string) => Promise<void>;
  readonly settle: () => Promise<void>;
  /** 模拟一次自动重读：页面上正在用的查询在原位重读（生产里由定时重读与回到前台补读完成，页面没有刷新按钮）。 */
  readonly reread: () => Promise<void>;
  readonly unmount: () => void;
}

/** 用真实路由树渲染整个工作台；只有 fetch 是假的。 */
export async function renderApp(initialPath: string, previousPath?: string, history?: RouterHistory, options?: { readonly scrollRestoration?: boolean }): Promise<RenderedApp> {
  const router = createRouter({ routeTree, history: history ?? createMemoryHistory({ initialEntries: previousPath ? [previousPath, initialPath] : [initialPath] }), scrollRestoration: options?.scrollRestoration, defaultErrorComponent: RouteErrorPanel });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const settle = async (): Promise<void> => {
    // 三轮：第一轮让 router 解析，第二轮让 query 发出并落地，第三轮让重渲染完成。
    for (let i = 0; i < 3; i += 1) await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
  };
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider catalog={catalog}>
          <RouterProvider router={router} />
        </I18nProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
  return {
    text: () => host.textContent ?? '',
    html: () => host.innerHTML,
    path: () => router.state.location.pathname,
    search: () => router.state.location.search,
    back: async () => { await act(async () => { router.history.back(); }); await settle(); },
    navigate: async (href) => { await act(async () => { await router.navigate({ href }); }); await settle(); },
    requestNavigate: async (href) => { await act(async () => { void router.navigate({ href }); }); await settle(); },
    click: async (label) => {
      // 闭合 <details> 里的内容和 hidden 一样看不见：菜单要先点开 summary 才能点里面的项。目标可能还在等一次读取，最多再等几拍。
      // 开着模态弹窗时只点最上层的弹窗：浏览器里弹窗背后的页面是 inert 的，点不到。
      const find = () => [...interactiveScope(host).querySelectorAll('button, a')].find((node) => !node.closest('[hidden]') && !node.closest('details:not([open])') && (node.textContent ?? '').includes(label));
      let target = find();
      for (let attempt = 0; target === undefined && attempt < 8; attempt++) { await settle(); target = find(); }
      if (target === undefined) throw new Error(`点不到「${label}」，当前页面文本：${host.textContent ?? ''}`);
      await act(async () => { (target as HTMLElement).click(); });
      await settle();
    },
    settle,
    reread: async () => { await act(async () => { await queryClient.refetchQueries({ type: 'active' }); }); await settle(); },
    unmount: () => {
      act(() => root.unmount());
      host.remove();
      queryClient.clear();
      history?.destroy();
    },
  };
}
