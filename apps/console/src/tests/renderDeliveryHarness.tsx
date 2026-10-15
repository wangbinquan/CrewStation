import './domSetup';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider, useParams } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../shared/lib/I18nProvider';
import { ProjectScopeProvider } from '../shared/project/ProjectScope';
import { parseDevelopmentSearch } from '../shared/project/developmentSearch';
import { parseReleaseSearch } from '../shared/project/releaseSearch';
import { ProjectListPage } from '../features/projects/pages/ProjectListPage';
import { FirstDeliveryPage } from '../features/projects/pages/FirstDeliveryPage';
import { ProjectOverviewPage } from '../features/projects/pages/ProjectOverviewPage';
import { parseProjectListSearch } from '../features/projects/model/projectListSearch';
import { DevSessionPage } from '../features/dev-session/pages/DevSessionPage';
import { PublishWizardPage } from '../features/release/pages/PublishWizardPage';
import { ReleaseJourneyPage } from '../features/release/pages/ReleaseJourneyPage';
import { ReleaseVersionPage } from '../features/release/pages/ReleaseVersionPage';
import { DeveloperAccessReview } from '../features/admin/components/DeveloperAccessReview';
import { messages as app } from '../app/i18n/zh-CN';
import { messages as projects } from '../features/projects/i18n/zh-CN';
import { messages as release } from '../features/release/i18n/zh-CN';
import { messages as dev } from '../features/dev-session/i18n/zh-CN';
import { messages as admin } from '../features/admin/i18n/zh-CN';
import { interactiveScope } from './interactiveScope';

/** 本次旅程的真实页面与 HTTP hooks；隔离其他 feature 的路由装配，不能替代整站验收。 */
export async function renderDeliveryHarness(path: string) {
  const rootRoute = createRootRoute({ component: () => <main><Outlet /></main> });
  const projectRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$projectId', component: Scope });
  const routes = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/projects', component: ProjectListPage, validateSearch: parseProjectListSearch }),
    createRoute({ getParentRoute: () => rootRoute, path: '/admin/requests', component: DeveloperAccessReview }),
    projectRoute.addChildren([
      createRoute({ getParentRoute: () => projectRoute, path: '/', component: ProjectOverviewPage }),
      createRoute({ getParentRoute: () => projectRoute, path: '/provisioning', component: FirstDeliveryPage }),
      createRoute({ getParentRoute: () => projectRoute, path: '/dev-session', component: DevSessionPage, validateSearch: parseDevelopmentSearch }),
      createRoute({ getParentRoute: () => projectRoute, path: '/release/publish', component: PublishWizardPage, validateSearch: parseReleaseSearch }),
      createRoute({ getParentRoute: () => projectRoute, path: '/release/journeys/$journeyId', component: ReleaseJourneyPage, validateSearch: parseReleaseSearch }),
      createRoute({ getParentRoute: () => projectRoute, path: '/release/versions/$releaseId', component: ReleaseVersionPage, validateSearch: parseReleaseSearch }),
    ]),
  ]);
  const router = createRouter({ routeTree: routes, history: createMemoryHistory({ initialEntries: [path] }) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const messages = { ...app, ...projects, ...release, ...dev, ...admin };
  const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
  await act(async () => { root.render(<QueryClientProvider client={client}><I18nProvider catalog={{ 'zh-CN': messages, 'en-US': messages }}><RouterProvider router={router} /></I18nProvider></QueryClientProvider>); });
  await settle();
  return { settle, client, host, text: () => host.textContent ?? '', path: () => router.state.location.pathname, search: () => router.state.location.search,
    go: async (to: string) => { await act(async () => { void router.navigate({ to }); }); await settle(); },
    click: async (label: string) => { const node = [...interactiveScope(host).querySelectorAll<HTMLElement>('button,a,summary')].find(item => !item.closest('[hidden]') && item.textContent === label); if (!node) throw new Error(`Missing ${label}: ${host.textContent}`); await act(async () => node.click()); await settle(); },
    reread: async () => { await act(async () => { await client.refetchQueries({ type: 'active' }); }); await settle(); },
    unmount: () => { act(() => root.unmount()); host.remove(); client.clear(); },
  };
}
function Scope() { const { projectId = '' } = useParams({ strict: false }); return <ProjectScopeProvider value={{ projectId, space: 'workbench' }}><Outlet /></ProjectScopeProvider>; }
