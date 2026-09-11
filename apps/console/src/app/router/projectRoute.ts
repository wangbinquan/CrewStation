import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './rootRoute';

/**
 * 项目内页面的公共父路由 /projects/$projectId。
 * 各 feature 把自己的页面挂在这里（getParentRoute: () => projectRoute），feature 之间因此不需要互相引用。
 */
export const projectRoute = createRoute({ getParentRoute: () => rootRoute, path: 'projects/$projectId' });
