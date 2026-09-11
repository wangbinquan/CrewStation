import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree';

export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true });

// 注册路由类型：Link 的 to／params 与 useParams 的 from 由此获得类型检查。
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
