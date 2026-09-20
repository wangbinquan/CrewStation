import { createRoute } from '@tanstack/react-router';
import { adminRoute } from '../../features/admin';
import { ClusterPage, parseClusterSearch } from '../../features/cluster';
export const clusterRoute = createRoute({ getParentRoute: () => adminRoute, path: 'cluster', component: ClusterPage, validateSearch: parseClusterSearch });
