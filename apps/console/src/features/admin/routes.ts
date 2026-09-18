import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../../app/router/rootRoute';
import { AdminLayout } from '../../app/layout/AdminLayout';
import { AdminAuthenticationPage } from './pages/AdminAuthenticationPage';
import { AdminComputePage } from './pages/AdminComputePage';
import { AdminEgressPage } from './pages/AdminEgressPage';
import { AdminGatewayPage } from './pages/AdminGatewayPage';
import { AdminOverviewPage } from './pages/AdminOverviewPage';
import { AdminServicePlansPage } from './pages/AdminServicePlansPage';
import { AdminTaskProfilesPage } from './pages/AdminTaskProfilesPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AdminProjectsPage } from './pages/AdminProjectsPage';
import { parseProjectDirectorySearch } from '../../shared/admin/projectDirectorySearch';
import { parseComputeSearch } from './model/computeSearch';

/** /admin：平台管理空间的根。布局与守卫在 AdminLayout，子页面只管自己的内容（RFC-002 §2.1）。 */
export const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: 'admin', component: AdminLayout });

export const adminOverviewRoute = createRoute({ getParentRoute: () => adminRoute, path: '/', component: AdminOverviewPage });
export const adminProjectsRoute = createRoute({ getParentRoute: () => adminRoute, path: 'projects', component: AdminProjectsPage, validateSearch: (search: Record<string, unknown>) => parseProjectDirectorySearch(search) });
export const adminUsersRoute = createRoute({ getParentRoute: () => adminRoute, path: 'users', component: AdminUsersPage });
export const adminAuthenticationRoute = createRoute({ getParentRoute: () => adminRoute, path: 'authentication', component: AdminAuthenticationPage });
export const adminComputeRoute = createRoute({ getParentRoute: () => adminRoute, path: 'compute', component: AdminComputePage, validateSearch: (search: Record<string, unknown>) => parseComputeSearch(search) });
export const adminServicePlansRoute = createRoute({ getParentRoute: () => adminRoute, path: 'service-plans', component: AdminServicePlansPage });
export const adminTaskProfilesRoute = createRoute({ getParentRoute: () => adminRoute, path: 'task-profiles', component: AdminTaskProfilesPage });
export const adminEgressRoute = createRoute({ getParentRoute: () => adminRoute, path: 'egress', component: AdminEgressPage });
export const adminGatewayRoute = createRoute({ getParentRoute: () => adminRoute, path: 'gateway', component: AdminGatewayPage });
