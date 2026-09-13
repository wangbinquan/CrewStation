import { createRoute } from '@tanstack/react-router';
import { parseSettingsSearch } from '../../shared/project/settingsSearch';
import { parseOperationsSearch } from '../../shared/project/operationsSearch';
import { ProjectSettingsPage } from '../project/ProjectSettingsPage';
import { ProjectOperationsPage } from '../project/ProjectOperationsPage';
import { projectRoute } from './projectRoute';

export const projectSettingsRoute = createRoute({ getParentRoute: () => projectRoute, path: 'settings', validateSearch: parseSettingsSearch, component: ProjectSettingsPage });
export const projectOperationsRoute = createRoute({ getParentRoute: () => projectRoute, path: 'operations', validateSearch: parseOperationsSearch, component: ProjectOperationsPage });
