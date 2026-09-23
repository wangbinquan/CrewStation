import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/** 容器最矮的高度：窗口过矮时宁可整页滚一点，也不把两栏压成几行。 */
const FILL_MIN = 360;

/**
 * 把 `--trace-fill` 设成从容器顶边到窗口底边（扣掉主区的下内边距）的高度，供样式在宽屏时把两栏撑满。
 * 外壳是随内容长的文档滚动，没有现成的定高父级，所以按位置量；窗口或主区尺寸变了重新量。
 */
export function useViewportFill(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const host = ref.current, main = host?.closest('main');
    if (!host) return;
    const fit = () => {
      const pad = main ? Number.parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      const top = host.getBoundingClientRect().top + window.scrollY + (main?.scrollTop ?? 0);
      host.style.setProperty('--trace-fill', `${Math.max(FILL_MIN, Math.floor(window.innerHeight - top - pad))}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (main) observer.observe(main);
    window.addEventListener('resize', fit);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [ref]);
}
