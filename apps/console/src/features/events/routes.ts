import { createRoute, redirect } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { parseOperationsSearch } from '../../shared/project/operationsSearch';

/** 保留旧链接中的有效上下文，replace 避免浏览器返回循环。 */
export const eventsRoute = createRoute({
  getParentRoute: () => projectRoute, path: 'events',
  validateSearch: (search: Record<string, unknown>) => parseOperationsSearch({ ...search, tab: 'deliveries' }),
  beforeLoad: ({ params, search }) => { throw redirect({ to: '/projects/$projectId/operations', params, search, replace: true }); },
});
