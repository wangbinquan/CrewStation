import { createRoute, redirect } from '@tanstack/react-router';
import { parseSettingsSearch } from '../../shared/project/settingsSearch';
import { parseResourceSearch, resourceDestination, resourceTarget } from '../../shared/project/resourceSearch';
import type { ResourceSearch } from '../../shared/project/resourceSearch';
import { hasLegacyOperationsTab, parseOperationsSearch } from '../../shared/project/operationsSearch';
import { parseDevelopmentSearch } from '../../shared/project/developmentSearch';
import { ProjectSettingsPage } from '../project/ProjectSettingsPage';
import { ProjectOperationsPage } from '../project/ProjectOperationsPage';
import { ProjectDevelopmentPage } from '../project/ProjectDevelopmentPage';
import { projectRoute } from './projectRoute';

/** 「开发资源」的旧地址各归其家（RFC-020 D2）：API／事件／平台接入 → 开发页参考面板（放大），数据 → 数据面板，项目与仓库 → 设置「项目信息」。 */
function redirectResource(params: { projectId: string }, search: ResourceSearch): never {
  const target = resourceTarget(search);
  if (target.page === 'settings') throw redirect({ to: '/projects/$projectId/settings', params, search: target.search, replace: true });
  throw redirect({ to: '/projects/$projectId/dev-session', params, search: target.search, replace: true });
}

/** /projects/$projectId/dev-session：开发会话（参考面板与内嵌日志由 app 装配）。 */
export const projectDevelopmentRoute = createRoute({ getParentRoute: () => projectRoute, path: 'dev-session', component: ProjectDevelopmentPage, validateSearch: parseDevelopmentSearch,
  beforeLoad: ({ search, params }) => { if (search.view === 'conversation') throw redirect({ to: '/projects/$projectId/dev-session/conversations', params, search: { agent: search.agent }, replace: true }); },
});
export const projectSettingsRoute = createRoute({ getParentRoute: () => projectRoute, path: 'settings', validateSearch: parseSettingsSearch, component: ProjectSettingsPage,
  beforeLoad: ({ params, search }) => {
    const resource = resourceDestination(search);
    if (resource) redirectResource(params, resource);
    if (search.tab === 'lifecycle') throw redirect({ to: '/projects/$projectId/settings', params, search: { tab: 'advanced' }, replace: true });
  },
});
export const projectResourcesRoute = createRoute({ getParentRoute: () => projectRoute, path: 'resources', validateSearch: parseResourceSearch,
  beforeLoad: ({ params, search }) => { redirectResource(params, search); },
});
export const projectOperationsRoute = createRoute({ getParentRoute: () => projectRoute, path: 'operations', validateSearch: parseOperationsSearch, component: ProjectOperationsPage,
  // 旧页签名 status（RFC-020 D3 合并期间）落到部署与运行形态：一次 replace 让地址与页面一致，其余参数照旧。
  beforeLoad: ({ params, search, location }) => { if (hasLegacyOperationsTab(location.searchStr)) throw redirect({ to: '/projects/$projectId/operations', params, search, replace: true }); },
});
