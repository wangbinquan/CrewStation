import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../../app/router/rootRoute';
import { AdminLayout } from '../../app/layout/AdminLayout';
import { AdminComputePage } from './pages/AdminComputePage';
import { AdminEgressPage } from './pages/AdminEgressPage';
import { AdminGatewayPage } from './pages/AdminGatewayPage';
import { AdminIntegrationsPage } from './pages/AdminIntegrationsPage';
import { AdminOverviewPage } from './pages/AdminOverviewPage';
import { AdminServicePlansPage } from './pages/AdminServicePlansPage';
import { AdminTaskProfilesPage } from './pages/AdminTaskProfilesPage';
import { AdminUsersPage } from './pages/AdminUsersPage';

/** /admin：平台管理空间的根。布局与守卫在 AdminLayout，子页面只管自己的内容（RFC-002 §2.1）。 */
export const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: 'admin', component: AdminLayout });

export const adminOverviewRoute = createRoute({ getParentRoute: () => adminRoute, path: '/', component: AdminOverviewPage });
export const adminUsersRoute = createRoute({ getParentRoute: () => adminRoute, path: 'users', component: AdminUsersPage });
export const adminComputeRoute = createRoute({ getParentRoute: () => adminRoute, path: 'compute', component: AdminComputePage });
export const adminServicePlansRoute = createRoute({ getParentRoute: () => adminRoute, path: 'service-plans', component: AdminServicePlansPage });
export const adminTaskProfilesRoute = createRoute({ getParentRoute: () => adminRoute, path: 'task-profiles', component: AdminTaskProfilesPage });
export const adminIntegrationsRoute = createRoute({ getParentRoute: () => adminRoute, path: 'integrations', component: AdminIntegrationsPage });
export const adminEgressRoute = createRoute({ getParentRoute: () => adminRoute, path: 'egress', component: AdminEgressPage });
export const adminGatewayRoute = createRoute({ getParentRoute: () => adminRoute, path: 'gateway', component: AdminGatewayPage });
