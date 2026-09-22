import { createRoute, redirect } from '@tanstack/react-router';
import { parseSettingsSearch } from '../../shared/project/settingsSearch';
import { parseResourceSearch, resourceDestination, resourceTarget } from '../../shared/project/resourceSearch';
import type { ResourceSearch } from '../../shared/project/resourceSearch';
import { hasLegacyOperationsTab, parseOperationsSearch } from '../../shared/project/operationsSearch';
import { ProjectSettingsPage } from '../project/ProjectSettingsPage';
import { ProjectResourcesPage } from '../project/ProjectResourcesPage';
import { ProjectOperationsPage } from '../project/ProjectOperationsPage';
import { projectRoute } from './projectRoute';

/** 「开发资源」的旧地址各归其家（RFC-020 D2）；参考面板落地前三个主题仍留在本页。 */
function redirectResource(params: { projectId: string }, search: ResourceSearch): never | undefined {
  const target = resourceTarget(search);
  if (target?.page === 'settings') throw redirect({ to: '/projects/$projectId/settings', params, search: target.search, replace: true });
  if (target?.page === 'development') throw redirect({ to: '/projects/$projectId/dev-session', params, search: target.search, replace: true });
  return undefined;
}

export const projectSettingsRoute = createRoute({ getParentRoute: () => projectRoute, path: 'settings', validateSearch: parseSettingsSearch, component: ProjectSettingsPage,
  beforeLoad: ({ params, search }) => {
    const resource = resourceDestination(search);
    if (resource) { redirectResource(params, resource); throw redirect({ to: '/projects/$projectId/resources', params, search: resource, replace: true }); }
    if (search.tab === 'lifecycle') throw redirect({ to: '/projects/$projectId/settings', params, search: { tab: 'advanced' }, replace: true });
  },
});
export const projectResourcesRoute = createRoute({ getParentRoute: () => projectRoute, path: 'resources', validateSearch: parseResourceSearch, component: ProjectResourcesPage,
  beforeLoad: ({ params, search }) => { redirectResource(params, search); },
});
export const projectOperationsRoute = createRoute({ getParentRoute: () => projectRoute, path: 'operations', validateSearch: parseOperationsSearch, component: ProjectOperationsPage,
  // 旧页签名（health／topology）已并入「状态」：一次 replace 让地址与页面一致，其余参数照旧。
  beforeLoad: ({ params, search, location }) => { if (hasLegacyOperationsTab(location.searchStr)) throw redirect({ to: '/projects/$projectId/operations', params, search, replace: true }); },
});
