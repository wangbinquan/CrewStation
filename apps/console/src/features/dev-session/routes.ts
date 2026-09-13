import { createRoute, redirect } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { DevSessionPage } from './pages/DevSessionPage';
import { HistoricalConversationsPage } from './pages/HistoricalConversationsPage';

/** /projects/$projectId/dev-session：开发会话 */
export const devSessionRoute = createRoute({ getParentRoute: () => projectRoute, path: 'dev-session', component: DevSessionPage,
  validateSearch: (search: Record<string, unknown>): { view?: string; agent?: string } => ({ ...(typeof search.view === 'string' ? { view: search.view } : {}), ...(typeof search.agent === 'string' ? { agent: search.agent } : {}) }),
  beforeLoad: ({ search, params }) => { if (search.view === 'conversation') throw redirect({ to: '/projects/$projectId/dev-session/conversations', params, search: { agent: search.agent }, replace: true }); },
});
export const historicalConversationsRoute = createRoute({ getParentRoute: () => projectRoute, path: 'dev-session/conversations', component: HistoricalConversationsPage,
  validateSearch: (search: Record<string, unknown>): { agent?: string } => ({ ...(typeof search.agent === 'string' ? { agent: search.agent } : {}) }),
});
