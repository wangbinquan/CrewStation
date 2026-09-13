import { createRoute, redirect } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { parseSettingsSearch } from '../../shared/project/settingsSearch';
import { workbenchRoute } from '../../app/router/workbenchRoute';
import { MarketPage } from './pages/MarketPage';
import { MarketDetailPage } from './pages/MarketDetailPage';

/** /projects/$projectId/capabilities：能力说明 */
export const capabilitiesRoute = createRoute({ getParentRoute: () => projectRoute, path: 'capabilities',
  validateSearch: (search: Record<string, unknown>) => parseSettingsSearch({ ...search, tab: 'resources' }),
  beforeLoad: ({ params, search }) => { throw redirect({ to: '/projects/$projectId/settings', params, search, replace: true }); },
});
export const marketHomeRoute = createRoute({ getParentRoute: () => workbenchRoute, path: '/', component: MarketPage });
export const marketRoute = createRoute({ getParentRoute: () => workbenchRoute, path: '/market', component: MarketPage });
export const marketDetailRoute = createRoute({ getParentRoute: () => workbenchRoute, path: '/market/$projectId', component: MarketDetailPage });
