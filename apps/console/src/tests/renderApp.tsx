import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { routeTree } from '../app/router/routeTree';
import { messages as appZh } from '../app/i18n/zh-CN';
import { messages as adminZh } from '../features/admin/i18n/zh-CN';
import { messages as projectsZh } from '../features/projects/i18n/zh-CN';
import { messages as releaseZh } from '../features/release/i18n/zh-CN';
import { messages as devSessionZh } from '../features/dev-session/i18n/zh-CN';
import { I18nProvider } from '../shared/lib/I18nProvider';
import { mergeMessages } from '../shared/lib/i18n';
import type { MessageCatalog } from '../shared/lib/i18n';

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
]);
const catalog: MessageCatalog = { 'zh-CN': zh, 'en-US': zh };

export interface RenderedApp {
  readonly text: () => string;
  readonly html: () => string;
  readonly path: () => string;
  /** 点击第一个文本匹配的按钮或链接；找不到就抛，免得断言在「什么都没发生」上通过。 */
  readonly click: (label: string) => Promise<void>;
  readonly settle: () => Promise<void>;
  readonly unmount: () => void;
}

/** 用真实路由树渲染整个工作台；只有 fetch 是假的。 */
export async function renderApp(initialPath: string): Promise<RenderedApp> {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
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
    click: async (label) => {
      const nodes = [...host.querySelectorAll('button, a')];
      const target = nodes.find((node) => (node.textContent ?? '').includes(label));
      if (target === undefined) throw new Error(`点不到「${label}」，当前页面文本：${host.textContent ?? ''}`);
      await act(async () => { (target as HTMLElement).click(); });
      await settle();
    },
    settle,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
      queryClient.clear();
    },
  };
}
