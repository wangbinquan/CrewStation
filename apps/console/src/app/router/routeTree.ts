// 路由树装配：app/ 只负责骨架，页面路由由各 feature 的 index.ts 导出。
// 两棵子树（RFC-002）：workbenchRoute 是租户空间，adminRoute 是平台管理空间。
import {
  adminComputeRoute, adminEgressRoute, adminGatewayRoute, adminIntegrationsRoute, adminOverviewRoute,
  adminRoute, adminServicePlansRoute, adminTaskProfilesRoute, adminUsersRoute,
} from '../../features/admin';
import { capabilitiesRoute, marketHomeRoute, marketRoute, marketDetailRoute } from '../../features/capabilities';
import { catalogRoute } from '../../features/catalog';
import { configRoute } from '../../features/config';
import { devSessionRoute, historicalConversationsRoute } from '../../features/dev-session';
import { eventsRoute } from '../../features/events';
import { logsRoute } from '../../features/logs';
import { projectListRoute, projectOverviewRoute } from '../../features/projects';
import { releaseRoute } from '../../features/release';
import { projectRoute } from './projectRoute';
import { projectSettingsRoute, projectOperationsRoute } from './projectSections';
import { rootRoute } from './rootRoute';
import { workbenchRoute } from './workbenchRoute';

export const routeTree = rootRoute.addChildren([
  workbenchRoute.addChildren([
    projectListRoute,
    marketHomeRoute,
    marketRoute,
    marketDetailRoute,
    projectRoute.addChildren([
      projectOverviewRoute,
      projectSettingsRoute,
      projectOperationsRoute,
      devSessionRoute,
      historicalConversationsRoute,
      releaseRoute,
      configRoute,
      catalogRoute,
      eventsRoute,
      logsRoute,
      capabilitiesRoute,
    ]),
  ]),
  adminRoute.addChildren([
    adminOverviewRoute,
    adminUsersRoute,
    adminComputeRoute,
    adminServicePlansRoute,
    adminTaskProfilesRoute,
    adminIntegrationsRoute,
    adminEgressRoute,
    adminGatewayRoute,
  ]),
]);
