import { createRoute } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { ReleasePage } from './pages/ReleasePage';
import { PublishWizardPage } from './pages/PublishWizardPage';
import { ReleaseJourneyPage } from './pages/ReleaseJourneyPage';
import { ReleaseVersionPage } from './pages/ReleaseVersionPage';
import { parseReleaseSearch } from '../../shared/project/releaseSearch';

/** /projects/$projectId/release：发布 */
export const releaseRoute = createRoute({ getParentRoute: () => projectRoute, path: 'release', validateSearch: parseReleaseSearch, component: ReleasePage });
export const publishWizardRoute = createRoute({ getParentRoute: () => projectRoute, path: 'release/publish', validateSearch: parseReleaseSearch, component: PublishWizardPage });
export const releaseJourneyRoute = createRoute({ getParentRoute: () => projectRoute, path: 'release/journeys/$journeyId', validateSearch: parseReleaseSearch, component: ReleaseJourneyPage });
export const releaseVersionRoute = createRoute({ getParentRoute: () => projectRoute, path: 'release/versions/$releaseId', validateSearch: parseReleaseSearch, component: ReleaseVersionPage });
