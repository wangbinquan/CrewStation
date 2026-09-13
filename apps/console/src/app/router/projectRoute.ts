import { createRoute } from '@tanstack/react-router';
import { workbenchRoute } from './workbenchRoute';
import { ProjectLayout } from '../layout/ProjectLayout';

/**
 * 项目内页面的公共父路由 /projects/$projectId，挂在租户空间下。
 * 各 feature 把自己的页面挂在这里（getParentRoute: () => projectRoute），feature 之间因此不需要互相引用。
 */
export const projectRoute = createRoute({ getParentRoute: () => workbenchRoute, path: 'projects/$projectId', component: ProjectLayout });
