import { createRoute, redirect } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { parseSettingsSearch } from '../../shared/project/settingsSearch';

/** 保留旧链接中的有效上下文，replace 避免浏览器返回循环。 */
export const configRoute = createRoute({
  getParentRoute: () => projectRoute, path: 'config',
  validateSearch: (search: Record<string, unknown>) => parseSettingsSearch({ ...search, tab: 'config' }),
  beforeLoad: ({ params, search }) => { throw redirect({ to: '/projects/$projectId/settings', params, search, replace: true }); },
});
