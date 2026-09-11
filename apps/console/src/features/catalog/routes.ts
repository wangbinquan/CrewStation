import { createRoute } from '@tanstack/react-router';
import { projectRoute } from '../../app/router/projectRoute';
import { CatalogPage } from './pages/CatalogPage';

/** /projects/$projectId/catalog：接口目录 */
export const catalogRoute = createRoute({ getParentRoute: () => projectRoute, path: 'catalog', component: CatalogPage });
