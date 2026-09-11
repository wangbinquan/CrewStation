import { createRootRoute } from '@tanstack/react-router';
import { AppShell } from '../layout/AppShell';
import { NotFound } from '../layout/NotFound';

/** 根路由：左侧导航＋顶栏的外壳，所有页面渲染在其 Outlet 中。 */
export const rootRoute = createRootRoute({ component: AppShell, notFoundComponent: NotFound });
