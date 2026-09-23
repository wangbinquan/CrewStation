import { Outlet, useRouterState } from '@tanstack/react-router';
import type { ReactElement, ReactNode } from 'react';
import styles from './AppShell.module.css';
import { TopBar } from './TopBar';
import { ConnectionNotice } from './ConnectionNotice';

/**
 * 宽屏下内容区是唯一的纵向滚动区（2026-09-23），窗口本身不滚：路由切页时把它滚回顶部、返回时恢复位置，
 * 靠的是这个标记（路由的 scrollToTopSelectors 与滚动记录都按它找元素）。
 */
export const MAIN_SCROLL_ID = 'cs-main';
export const MAIN_SCROLL_SELECTOR = `[data-scroll-restoration-id="${MAIN_SCROLL_ID}"]`;

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
    <div className={[styles.shell, !nav && styles.noNav].filter(Boolean).join(' ')}>
      {nav}
      <TopBar />
      <main data-scroll-restoration-id={MAIN_SCROLL_ID} className={[styles.main, compact && styles.compact].filter(Boolean).join(' ')}>
        <div className={styles.content}><ConnectionNotice />{children ?? <Outlet />}</div>
      </main>
    </div>
  );
}
