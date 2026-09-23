import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/** 容器最矮的高度：窗口过矮时宁可整页滚一点，也不把两栏压成几行。 */
const FILL_MIN = 360;

/**
 * 把 `--viewport-fill` 设成从容器顶边到窗口底边（扣掉主区的下内边距）的高度，供样式在宽屏时把容器撑满一屏、
 * 里面的各栏各自滚动，整页不出纵向滚动条（调用链、集群管理、部署与运行形态，2026-09-23 作者裁定）。
 * 容器往往嵌在页头与页签之下，外壳也不保证有定高的父级，所以按位置量。窗口、主区或主区内容的尺寸变了就重量：
 * 主区定高时它自己的尺寸不变，上方多出一条连接提示或读取错误只改变内容的高度。
 */
export function useViewportFill(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const host = ref.current, main = host?.closest('main');
    if (!host) return;
    const fit = () => {
      const pad = main ? Number.parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      const top = host.getBoundingClientRect().top + window.scrollY + (main?.scrollTop ?? 0);
      host.style.setProperty('--viewport-fill', `${Math.max(FILL_MIN, Math.floor(window.innerHeight - top - pad))}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit);
    for (const target of [main, main?.firstElementChild]) if (target && observer) observer.observe(target);
    return () => { observer?.disconnect(); window.removeEventListener('resize', fit); };
  }, [ref]);
}
