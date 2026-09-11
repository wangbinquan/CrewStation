import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../../app/router/rootRoute';
import { AdminPage } from './pages/AdminPage';

/** /admin：管理员 */
export const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: 'admin', component: AdminPage });
