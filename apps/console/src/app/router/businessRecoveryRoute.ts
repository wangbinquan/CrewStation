import { createRoute } from '@tanstack/react-router';
import { adminRoute } from '../../features/admin';
import { AdminBusinessRecoveryPage } from '../admin/AdminBusinessRecoveryPage';

export const businessRecoveryRoute = createRoute({ getParentRoute: () => adminRoute, path: 'business-execution', component: AdminBusinessRecoveryPage });
