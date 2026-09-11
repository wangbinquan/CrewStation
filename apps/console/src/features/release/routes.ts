import { createRoute } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { ReleasePage } from './pages/ReleasePage';

/** /projects/$projectId/release：发布 */
export const releaseRoute = createRoute({ getParentRoute: () => projectRoute, path: 'release', component: ReleasePage });
