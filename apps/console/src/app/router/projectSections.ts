import { createRoute, redirect } from '@tanstack/react-router';
import { parseSettingsSearch } from '../../shared/project/settingsSearch';
import { parseResourceSearch, resourceDestination } from '../../shared/project/resourceSearch';
import { parseOperationsSearch } from '../../shared/project/operationsSearch';
import { ProjectSettingsPage } from '../project/ProjectSettingsPage';
import { ProjectResourcesPage } from '../project/ProjectResourcesPage';
import { ProjectOperationsPage } from '../project/ProjectOperationsPage';
import { projectRoute } from './projectRoute';

export const projectSettingsRoute = createRoute({ getParentRoute: () => projectRoute, path: 'settings', validateSearch: parseSettingsSearch, component: ProjectSettingsPage,
  beforeLoad: ({ params, search }) => {
    const target = resourceDestination(search);
    if (target) throw redirect({ to: '/projects/$projectId/resources', params, search: target, replace: true });
    if (search.tab === 'lifecycle') throw redirect({ to: '/projects/$projectId/settings', params, search: { tab: 'advanced' }, replace: true });
  },
});
export const projectResourcesRoute = createRoute({ getParentRoute: () => projectRoute, path: 'resources', validateSearch: parseResourceSearch, component: ProjectResourcesPage });
export const projectOperationsRoute = createRoute({ getParentRoute: () => projectRoute, path: 'operations', validateSearch: parseOperationsSearch, component: ProjectOperationsPage });
