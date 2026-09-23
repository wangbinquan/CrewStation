import { createRouter } from '@tanstack/react-router';
import { MAIN_SCROLL_SELECTOR } from '../layout/AppShell';
import { RouteErrorPanel } from './RouteErrorPanel';
import { routeTree } from './routeTree';

// defaultErrorComponent 让每一层路由都有自己的错误边界：一页出错只换掉那一页，外壳与导航留着。
// 宽屏滚的是内容区而不是窗口（2026-09-23）：scrollToTopSelectors 让切页时内容区也回到顶部；resetScroll: false 的导航两者都不动。
export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true, scrollToTopSelectors: [MAIN_SCROLL_SELECTOR], defaultErrorComponent: RouteErrorPanel });

// 注册路由类型：Link 的 to／params 与 useParams 的 from 由此获得类型检查。
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
