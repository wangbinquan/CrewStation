import { createRoute } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { EventsPage } from './pages/EventsPage';

/** /projects/$projectId/events：事件 */
export const eventsRoute = createRoute({ getParentRoute: () => projectRoute, path: 'events', component: EventsPage });
