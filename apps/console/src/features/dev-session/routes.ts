import { createRoute, redirect } from '@tanstack/react-router';
import { parseDevelopmentSearch, parseConversationSearch } from '../../shared/project/developmentSearch';
import { projectRoute } from '../../app/router/projectRoute';
import { DevSessionPage } from './pages/DevSessionPage';
import { HistoricalConversationsPage } from './pages/HistoricalConversationsPage';

/** /projects/$projectId/dev-session：开发会话 */
export const devSessionRoute = createRoute({ getParentRoute: () => projectRoute, path: 'dev-session', component: DevSessionPage,
  validateSearch: parseDevelopmentSearch,
  beforeLoad: ({ search, params }) => { if (search.view === 'conversation') throw redirect({ to: '/projects/$projectId/dev-session/conversations', params, search: { agent: search.agent }, replace: true }); },
});
export const historicalConversationsRoute = createRoute({ getParentRoute: () => projectRoute, path: 'dev-session/conversations', component: HistoricalConversationsPage,
  validateSearch: parseConversationSearch,
});
