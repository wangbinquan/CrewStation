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
