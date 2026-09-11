import { createRoute } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { rootRoute } from '../../app/router/rootRoute';
import { ProjectListPage } from './pages/ProjectListPage';
import { ProjectOverviewPage } from './pages/ProjectOverviewPage';

/** /：项目列表 */
export const projectListRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: ProjectListPage });

/** /projects/$projectId：项目概览（两个部署槽、Release、发布入口） */
export const projectOverviewRoute = createRoute({ getParentRoute: () => projectRoute, path: '/', component: ProjectOverviewPage });
