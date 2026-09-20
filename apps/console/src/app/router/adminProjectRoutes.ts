import { createRoute, redirect } from '@tanstack/react-router';
import { adminRoute } from '../../features/admin';
import { DevSessionPage, HistoricalConversationsPage } from '../../features/dev-session';
import { ProjectOverviewPage } from '../../features/projects';
import { ReleasePage } from '../../features/release';
import { parseDevelopmentSearch, parseConversationSearch } from '../../shared/project/developmentSearch';
import { parseOperationsSearch } from '../../shared/project/operationsSearch';
import { parseResourceSearch, resourceDestination } from '../../shared/project/resourceSearch';
import { ProjectResourcesPage } from '../project/ProjectResourcesPage';
import { parseSettingsSearch } from '../../shared/project/settingsSearch';
import { parseReleaseSearch } from '../../shared/project/releaseSearch';
import { AdminProjectLayout } from '../layout/ProjectLayout';
import { ProjectOperationsPage } from '../project/ProjectOperationsPage';
import { ProjectSettingsPage } from '../project/ProjectSettingsPage';

export const adminProjectRoute = createRoute({ getParentRoute: () => adminRoute, path: 'integrations/$projectId', component: AdminProjectLayout });
const overview = createRoute({ getParentRoute: () => adminProjectRoute, path: '/', component: ProjectOverviewPage });
const development = createRoute({ getParentRoute: () => adminProjectRoute, path: 'dev-session', component: DevSessionPage, validateSearch: parseDevelopmentSearch,
  beforeLoad: ({ search, params }) => { if (search.view === 'conversation') throw redirect({ to: '/admin/integrations/$projectId/dev-session/conversations', params, search: { agent: search.agent }, replace: true }); },
});
const conversations = createRoute({ getParentRoute: () => adminProjectRoute, path: 'dev-session/conversations', component: HistoricalConversationsPage, validateSearch: parseConversationSearch });
const release = createRoute({ getParentRoute: () => adminProjectRoute, path: 'release', component: ReleasePage, validateSearch: parseReleaseSearch });
const operations = createRoute({ getParentRoute: () => adminProjectRoute, path: 'operations', component: ProjectOperationsPage, validateSearch: parseOperationsSearch });
const settings = createRoute({ getParentRoute: () => adminProjectRoute, path: 'settings', component: ProjectSettingsPage, validateSearch: (search: Record<string, unknown>) => parseSettingsSearch({ ...search, tab: search.tab === 'visibility' ? 'config' : search.tab }),
  beforeLoad: ({ params, search }) => {
    const target = resourceDestination(search);
    if (target) throw redirect({ to: '/admin/integrations/$projectId/resources', params, search: target, replace: true });
    if (search.tab === 'lifecycle') throw redirect({ to: '/admin/integrations/$projectId/settings', params, search: { tab: 'advanced' }, replace: true });
  },
});
const resources = createRoute({ getParentRoute: () => adminProjectRoute, path: 'resources', component: ProjectResourcesPage, validateSearch: parseResourceSearch });
export const adminProjectRoutes = adminProjectRoute.addChildren([overview, development, conversations, release, operations, settings, resources]);
