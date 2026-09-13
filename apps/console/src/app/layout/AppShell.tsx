import { Outlet, useRouterState } from '@tanstack/react-router';
import type { ReactElement, ReactNode } from 'react';
import styles from './AppShell.module.css';
import { TopBar } from './TopBar';

export interface AppShellProps {
  /** 左栏：租户空间与平台管理空间各自一套（RFC-002）。 */
  readonly nav: ReactNode;
  /** 默认渲染子路由；管理空间用它把 Outlet 包在守卫里面。 */
  readonly children?: ReactNode;
}

/** 外壳：左栏、顶栏、内容区。左栏由空间决定，外壳本身不知道自己在哪个空间。 */
export function AppShell({ nav, children }: AppShellProps): ReactElement {
  const compact = useRouterState({ select: (state) => state.location.pathname.endsWith('/dev-session') });
  return (
    <div className={[styles.shell, compact && styles.compactShell].filter(Boolean).join(' ')}>
      {nav}
      <TopBar />
      <main className={[styles.main, compact && styles.compact].filter(Boolean).join(' ')}>
        <div className={styles.content}>{children ?? <Outlet />}</div>
      </main>
    </div>
  );
}
