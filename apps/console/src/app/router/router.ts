import { createRouter } from '@tanstack/react-router';
import { RouteErrorPanel } from './RouteErrorPanel';
import { routeTree } from './routeTree';

// defaultErrorComponent 让每一层路由都有自己的错误边界：一页出错只换掉那一页，外壳与导航留着。
export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true, defaultErrorComponent: RouteErrorPanel });

// 注册路由类型：Link 的 to／params 与 useParams 的 from 由此获得类型检查。
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
