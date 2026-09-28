import { createRoute } from '@tanstack/react-router';
import { adminRoute } from '../../features/admin';
import { ProjectRuntimeStatisticsPage, SystemRuntimeStatisticsPage, parseRuntimeSearch } from '../../features/observability';
import { projectRoute } from './projectRoute';
export const systemObservabilityRoute = createRoute({ getParentRoute: () => adminRoute, path: 'observability', component: SystemRuntimeStatisticsPage, validateSearch: parseRuntimeSearch });
export const systemObservationTaskRoute = createRoute({ getParentRoute: () => adminRoute, path: 'observability/tasks/$taskId', component: SystemRuntimeStatisticsPage, validateSearch: parseRuntimeSearch });
export const projectObservabilityRoute = createRoute({ getParentRoute: () => projectRoute, path: 'observability', component: ProjectRuntimeStatisticsPage, validateSearch: parseRuntimeSearch });
export const projectObservationTaskRoute = createRoute({ getParentRoute: () => projectRoute, path: 'observability/tasks/$taskId', component: ProjectRuntimeStatisticsPage, validateSearch: parseRuntimeSearch });
