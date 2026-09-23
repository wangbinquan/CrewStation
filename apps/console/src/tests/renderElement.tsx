import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { messages as appMessages } from '../app/i18n/zh-CN';
import { I18nProvider } from '../shared/lib/I18nProvider';
import type { Messages } from '../shared/lib/i18n';
import { interactiveScope } from './interactiveScope';

/** 可独立验证共享组件和有真实 Query 行为的 feature 部件；路由旅程仍用 renderApp。 */
export async function renderElement(element: ReactElement, messages: Messages) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const catalog = { 'zh-CN': { ...appMessages, ...messages }, 'en-US': messages };
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
  await act(async () => root.render(<QueryClientProvider client={client}><I18nProvider catalog={catalog}>{element}</I18nProvider></QueryClientProvider>));
  await settle();
  // 开着模态弹窗时只找最上层弹窗里的按钮：浏览器里弹窗背后的页面点不到。
  const button = (label: string) => [...interactiveScope(host).querySelectorAll('button')].find((node) => node.textContent === label)!;
  return {
    host, text: () => host.textContent ?? '', button, settle,
    click: async (label: string) => { await act(async () => button(label).click()); await settle(); },
    /** 模拟一次自动重读：正在用的查询在原位重读（页面没有刷新按钮，生产里由定时重读完成；与 renderApp 相同）。 */
    reread: async () => { await act(async () => { await client.refetchQueries({ type: 'active' }); }); await settle(); },
    unmount: () => { act(() => root.unmount()); host.remove(); client.clear(); },
  };
}
