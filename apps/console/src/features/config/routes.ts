import { createRoute } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { ConfigPage } from './pages/ConfigPage';

/** /projects/$projectId/config：配置与密钥 */
export const configRoute = createRoute({ getParentRoute: () => projectRoute, path: 'config', component: ConfigPage });
