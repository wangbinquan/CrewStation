import { createRoute } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { DevSessionPage } from './pages/DevSessionPage';

/** /projects/$projectId/dev-session：开发会话 */
export const devSessionRoute = createRoute({ getParentRoute: () => projectRoute, path: 'dev-session', component: DevSessionPage });
