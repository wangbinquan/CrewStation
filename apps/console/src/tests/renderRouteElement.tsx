import type { ReactElement } from 'react';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import type { Messages } from '../shared/lib/i18n';
import { renderElement } from './renderElement';

/** 兼容部件的独立路由上下文；正式入口旅程使用 renderApp。 */
export async function renderRouteElement(element: ReactElement, messages: Messages) {
  const routeTree = createRootRoute({ component: () => element });
  const history = createMemoryHistory({ initialEntries: ['/'] }), router = createRouter({ routeTree, history });
  await router.load();
  const rendered = await renderElement(<RouterProvider router={router} />, messages);
  return { ...rendered, unmount: () => { rendered.unmount(); history.destroy(); } };
}
