import { createRoute } from '@tanstack/react-router';
import { parseConversationSearch } from '../../shared/project/developmentSearch';
import { projectRoute } from '../../app/router/projectRoute';
import { HistoricalConversationsPage } from './pages/HistoricalConversationsPage';

/** /projects/$projectId/dev-session 由 app 装配（参考面板与内嵌日志来自其他 feature，见 app/project/ProjectDevelopmentPage）；这里只剩历史对话。 */
export const historicalConversationsRoute = createRoute({ getParentRoute: () => projectRoute, path: 'dev-session/conversations', component: HistoricalConversationsPage,
  validateSearch: parseConversationSearch,
});
