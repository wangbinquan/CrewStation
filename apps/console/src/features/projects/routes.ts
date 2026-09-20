import { createRoute } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { workbenchRoute } from '../../app/router/workbenchRoute';
import { ProjectListPage } from './pages/ProjectListPage';
import { ProjectOverviewPage } from './pages/ProjectOverviewPage';
import { SelfCreateProject } from './components/creation/SelfCreateProject';
import { SelfProjectProvisioningPage } from './pages/SelfProjectProvisioningPage';
import { parseProjectListSearch } from './model/projectListSearch';

/** /：项目列表。挂在租户空间下（RFC-002），左栏由 workbenchRoute 提供。 */
export const selfProjectCreateRoute = createRoute({ getParentRoute: () => workbenchRoute, path: '/projects/new', component: SelfCreateProject });
export const selfProjectProvisioningRoute = createRoute({ getParentRoute: () => projectRoute, path: '/provisioning', component: SelfProjectProvisioningPage });

export const projectListRoute = createRoute({ getParentRoute: () => workbenchRoute, path: '/projects', component: ProjectListPage, validateSearch: parseProjectListSearch });

/** /projects/$projectId：项目概览（两个部署槽、Release、发布入口） */
export const projectOverviewRoute = createRoute({ getParentRoute: () => projectRoute, path: '/', component: ProjectOverviewPage });
