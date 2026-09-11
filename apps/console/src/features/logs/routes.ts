import { createRoute } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { LogsPage } from './pages/LogsPage';

/** /projects/$projectId/logs：日志 */
export const logsRoute = createRoute({ getParentRoute: () => projectRoute, path: 'logs', component: LogsPage });
