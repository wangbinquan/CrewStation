import { createRoute } from '@tanstack/react-router';
import { adminRoute } from '../../features/admin';
import { AdminBusinessRecoveryPage } from '../admin/AdminBusinessRecoveryPage';
import { parseBusinessRecoverySearch } from '../../features/business-recovery/model/recoverySearch';

export const businessRecoveryRoute = createRoute({ getParentRoute: () => adminRoute, path: 'business-execution', component: AdminBusinessRecoveryPage, validateSearch: parseBusinessRecoverySearch });
