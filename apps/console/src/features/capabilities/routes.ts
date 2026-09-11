import { createRoute } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { CapabilitiesPage } from './pages/CapabilitiesPage';

/** /projects/$projectId/capabilities：能力说明 */
export const capabilitiesRoute = createRoute({ getParentRoute: () => projectRoute, path: 'capabilities', component: CapabilitiesPage });
