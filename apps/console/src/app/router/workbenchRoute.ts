import { createRoute } from '@tanstack/react-router';
import { WorkbenchLayout } from '../layout/WorkbenchLayout';
import { rootRoute } from './rootRoute';

/**
 * 租户空间的无路径布局路由（RFC-002）：不占路径段，只提供租户左栏这层外壳，
 * 项目列表与项目内页面都挂在它下面。
 */
export const workbenchRoute = createRoute({ getParentRoute: () => rootRoute, id: 'workbench', component: WorkbenchLayout });
