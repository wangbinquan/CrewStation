import { createRoute, redirect } from '@tanstack/react-router';
import { adminRoute } from '../../features/admin';
import { parseCapabilitySearch, parseRequestSearch } from '../../shared/admin/managementSearch';
import { AdminCapabilitiesPage } from '../admin/AdminCapabilitiesPage';
import { AdminRequestsPage } from '../admin/AdminRequestsPage';
import { AdminProjectCreationPage, AdminProjectProvisioningPage } from '../admin/AdminProjectCreationPage';

export const adminProjectCreateRoute = createRoute({ getParentRoute: () => adminRoute, path: 'projects/new', component: AdminProjectCreationPage,
  validateSearch: (search: Record<string, unknown>): { scope: 'integration' | 'digital-worker' } => ({ scope: search.scope === 'integration' ? 'integration' : 'digital-worker' }),
});
export const adminProjectProvisioningRoute = createRoute({ getParentRoute: () => adminRoute, path: 'projects/$projectId/provisioning', component: AdminProjectProvisioningPage });

export const adminCapabilitiesRoute = createRoute({ getParentRoute: () => adminRoute, path: 'capabilities', component: AdminCapabilitiesPage, validateSearch: parseCapabilitySearch });
export const adminRequestsRoute = createRoute({ getParentRoute: () => adminRoute, path: 'requests', component: AdminRequestsPage, validateSearch: parseRequestSearch });
export const adminIntegrationsLegacyRoute = createRoute({ getParentRoute: () => adminRoute, path: 'integrations',
  validateSearch: (search: Record<string, unknown>) => parseCapabilitySearch({ ...search, tab: 'integrations' }),
  beforeLoad: ({ search }) => { throw redirect({ to: '/admin/capabilities', search, replace: true }); },
});
export const adminCatalogLegacyRoute = createRoute({ getParentRoute: () => adminRoute, path: 'api-catalog',
  validateSearch: (search: Record<string, unknown>) => parseCapabilitySearch({ ...search, tab: 'api' }),
  beforeLoad: ({ search }) => { throw redirect({ to: '/admin/capabilities', search, replace: true }); },
});
/** RFC-018 下线出站白名单；旧书签与旧文档里的链接仍然可用，落到管理总览而不是 404。 */
export const adminEgressLegacyRoute = createRoute({ getParentRoute: () => adminRoute, path: 'egress',
  beforeLoad: () => { throw redirect({ to: '/admin', replace: true }); },
});
