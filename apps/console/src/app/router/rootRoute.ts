import { createRootRoute } from '@tanstack/react-router';
import { AppRoot } from '../layout/AppRoot';
import { NotFound } from '../layout/NotFound';

/**
 * 根路由本身不画外壳：两个空间各有自己的左栏，外壳由 workbenchRoute／adminRoute 渲染（RFC-002 §2.1）。
 * 这里只留一个透传的 Outlet 与全局的 404 页。
 */
export const rootRoute = createRootRoute({ component: AppRoot, notFoundComponent: NotFound });
