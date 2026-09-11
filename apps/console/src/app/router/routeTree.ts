// 路由树装配：app/ 只负责骨架，页面路由由各 feature 的 index.ts 导出。
import { adminRoute } from '../../features/admin';
import { capabilitiesRoute } from '../../features/capabilities';
import { catalogRoute } from '../../features/catalog';
import { configRoute } from '../../features/config';
import { devSessionRoute } from '../../features/dev-session';
import { eventsRoute } from '../../features/events';
import { logsRoute } from '../../features/logs';
import { projectListRoute, projectOverviewRoute } from '../../features/projects';
import { releaseRoute } from '../../features/release';
import { projectRoute } from './projectRoute';
import { rootRoute } from './rootRoute';

export const routeTree = rootRoute.addChildren([
  projectListRoute,
  adminRoute,
  projectRoute.addChildren([
    projectOverviewRoute,
    devSessionRoute,
    releaseRoute,
    configRoute,
    catalogRoute,
    eventsRoute,
    logsRoute,
    capabilitiesRoute,
  ]),
]);
