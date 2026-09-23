import { clusterRoute } from './clusterRoute';
// 路由树装配：app/ 只负责骨架，页面路由由各 feature 的 index.ts 导出。
// 两棵子树（RFC-002）：workbenchRoute 是租户空间，adminRoute 是平台管理空间。
import {
  adminAuthenticationRoute, adminComputeRoute, adminGatewayRoute, adminOverviewRoute, adminProjectsRoute,
  adminProjectComputeRoute, adminProjectResourcesRoute, adminResourceTemplatesRoute, adminRoute, adminServicePlansRoute, adminSettingsRoute, adminTaskProfilesRoute, adminUsersRoute,
} from '../../features/admin';
import { capabilitiesRoute, marketHomeRoute, marketRoute, marketLegacyRoute } from '../../features/capabilities';
import { catalogRoute } from '../../features/catalog';
import { configRoute } from '../../features/config';
import { historicalConversationsRoute } from '../../features/dev-session';
import { eventsRoute } from '../../features/events';
import { logsRoute } from '../../features/logs';
import { selfProjectCreateRoute, selfProjectProvisioningRoute, projectListRoute, projectOverviewRoute } from '../../features/projects';
import { releaseRoute } from '../../features/release';
import { projectRoute } from './projectRoute';
import { adminProjectRoutes } from './adminProjectRoutes';
import { adminCapabilitiesRoute, adminRequestsRoute, adminIntegrationsLegacyRoute, adminCatalogLegacyRoute, adminEgressLegacyRoute, adminProjectCreateRoute, adminProjectProvisioningRoute } from './adminGlobalRoutes';
import { projectDevelopmentRoute, projectSettingsRoute, projectOperationsRoute, projectResourcesRoute } from './projectSections';
import { rootRoute } from './rootRoute';
import { workbenchRoute } from './workbenchRoute';

export const routeTree = rootRoute.addChildren([
  workbenchRoute.addChildren([
    projectListRoute,
    selfProjectCreateRoute,
    marketHomeRoute,
    marketRoute,
    marketLegacyRoute,
    projectRoute.addChildren([
      projectOverviewRoute,
      selfProjectProvisioningRoute,
      projectSettingsRoute,
      projectResourcesRoute,
      projectOperationsRoute,
      projectDevelopmentRoute,
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
    clusterRoute,
    adminOverviewRoute,
    adminProjectsRoute,
    adminProjectComputeRoute,
    adminProjectResourcesRoute,
    adminResourceTemplatesRoute,
    adminProjectCreateRoute,
    adminProjectProvisioningRoute,
    adminProjectRoutes,
    adminUsersRoute,
    adminAuthenticationRoute,
    adminComputeRoute,
    adminServicePlansRoute,
    adminTaskProfilesRoute,
    adminCapabilitiesRoute,
    adminRequestsRoute,
    adminIntegrationsLegacyRoute,
    adminCatalogLegacyRoute,
    adminEgressLegacyRoute,
    adminGatewayRoute,
    adminSettingsRoute,
  ]),
]);
