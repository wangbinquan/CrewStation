import { createRoute, redirect } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { legacyResourceSearch } from '../../shared/project/resourceSearch';
import { workbenchRoute } from '../../app/router/workbenchRoute';
import { MarketPage } from './pages/MarketPage';
import { AppAccessPage } from './pages/AppAccessPage';

/** /projects/$projectId/capabilities：能力说明 */
export const capabilitiesRoute = createRoute({ getParentRoute: () => projectRoute, path: 'capabilities',
  validateSearch: (search: Record<string, unknown>) => legacyResourceSearch(search),
  beforeLoad: ({ params, search }) => { throw redirect({ to: '/projects/$projectId/resources', params, search, replace: true }); },
});
export const marketHomeRoute = createRoute({ getParentRoute: () => workbenchRoute, path: '/', component: MarketPage });
export const marketRoute = createRoute({ getParentRoute: () => workbenchRoute, path: '/market', component: MarketPage });
/** /apps/$projectId/access：申请访问权限（2026-09-24）；网关的「没有项目权限」页从正式地址新开到这里，任何登录用户都能进。 */
export const appAccessRoute = createRoute({ getParentRoute: () => workbenchRoute, path: '/apps/$projectId/access', component: AppAccessPage });
export const marketLegacyRoute = createRoute({ getParentRoute: () => workbenchRoute, path: '/market/$projectId',
  beforeLoad: () => { throw redirect({ to: '/market', replace: true }); },
});
