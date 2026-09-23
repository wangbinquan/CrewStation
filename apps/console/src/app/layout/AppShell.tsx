import { Outlet, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import type { ReactElement, ReactNode, RefObject } from 'react';
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

/**
 * 页面打开与换页之后把焦点放到内容区（2026-09-23 作者裁定）：宽屏滚的是内容区，焦点停在 body 或左栏时 PageDown／空格
 * 交给已经不能滚的根，内容区不动。只在换了路径时做——页签、筛选只改地址参数，焦点留在原处；焦点已经在内容区或弹窗里
 * （页面自己聚焦了某个控件）不抢。Tab 因此从内容区里的第一个控件开始，Shift+Tab 回到顶栏与左栏。
 */
function useFocusMainOnPageChange(main: RefObject<HTMLElement | null>): void {
  const router = useRouter();
  useEffect(() => {
    const focus = () => {
      const element = main.current, active = document.activeElement;
      if (!element || (active !== null && active !== document.body && (element.contains(active) || active.closest('dialog[open]') !== null))) return;
      element.focus({ preventScroll: true });
    };
    focus();
    return router.subscribe('onRendered', (event) => { if (event.pathChanged) focus(); });
  }, [router, main]);
}

/** 外壳：左栏、顶栏、内容区。左栏由空间决定，外壳本身不知道自己在哪个空间。 */
export function AppShell({ nav, children }: AppShellProps): ReactElement {
  const compact = useRouterState({ select: (state) => state.location.pathname.endsWith('/dev-session') });
  const main = useRef<HTMLElement>(null);
  useFocusMainOnPageChange(main);
  return (
    <div className={[styles.shell, !nav && styles.noNav].filter(Boolean).join(' ')}>
      {nav}
      <TopBar />
      <main ref={main} tabIndex={-1} data-scroll-restoration-id={MAIN_SCROLL_ID} className={[styles.main, compact && styles.compact].filter(Boolean).join(' ')}>
        <div className={styles.content}><ConnectionNotice />{children ?? <Outlet />}</div>
      </main>
    </div>
  );
}
