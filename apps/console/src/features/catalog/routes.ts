import { createRoute, redirect } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { parseResourceSearch } from '../../shared/project/resourceSearch';

/** 保留旧链接中的有效上下文，replace 避免浏览器返回循环。 */
export const catalogRoute = createRoute({
  getParentRoute: () => projectRoute, path: 'catalog',
  validateSearch: (search: Record<string, unknown>) => parseResourceSearch({ ...search, section: 'api' }),
  beforeLoad: ({ params, search }) => { throw redirect({ to: '/projects/$projectId/resources', params, search, replace: true }); },
});
