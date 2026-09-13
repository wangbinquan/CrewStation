import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { messages as appMessages } from '../app/i18n/zh-CN';
import { I18nProvider } from '../shared/lib/I18nProvider';
import type { Messages } from '../shared/lib/i18n';

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
  const button = (label: string) => [...host.querySelectorAll('button')].find((node) => node.textContent === label)!;
  return {
    host, text: () => host.textContent ?? '', button, settle,
    click: async (label: string) => { await act(async () => button(label).click()); await settle(); },
    unmount: () => { act(() => root.unmount()); host.remove(); client.clear(); },
  };
}
