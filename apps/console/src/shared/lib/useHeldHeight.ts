import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { flushSync } from 'react-dom';

const PENDING = '[data-query-state="pending"]';

/**
 * 面板换查询时撑住高度。新查询回来之前面板里只剩一行「载入中」，整块内容塌掉，浏览器把滚动位置钳到新的最大值，
 * 页签条与列表一起被顶出视口（2026-09-22 实机：集群管理切页签，scrollY 979 → 262）。
 *
 * `contentKey` 标识面板当前该显示哪份内容（视图＋筛选）：键变了而内容还没量到，这一次提交就带上上一次量到的高度做 min-height。
 * 不能等到效应里再挂——同一次提交里别处的布局读取（页签条量宽度）会先让浏览器按塌掉的高度钳住滚动位置，之后再撑高也回不来。
 * 键没变而子组件自己进入载入态（节点表翻页、趋势换范围）靠观察 DOM 里 QueryStatus 的 `data-query-state` 兜底。
 * 面板里不再有载入中的读操作时放开并记下新高度；内容确实变短（节点表比 Pod 表短）时文档自然缩短，那是真实终态，不再干预。
 * 与 useApiQuery 的 keepPrevious 分工：条件没变只换快照时留住旧数据；条件变了必须重读时撑住高度。
 */
export function useHeldHeight<T extends HTMLElement>(contentKey: string): [RefObject<T | null>, CSSProperties | undefined] {
  const ref = useRef<T>(null);
  const [settled, setSettled] = useState({ key: '', height: 0 });
  const [held, setHeld] = useState<number>();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const sync = (inCommit: boolean) => {
      if (element.querySelector(PENDING) !== null) {
        if (held === undefined && settled.height > 0) { if (inCommit) setHeld(settled.height); else flushSync(() => setHeld(settled.height)); }
        return;
      }
      if (held !== undefined) setHeld(undefined);
      // 内容齐了才量高度：此时读布局不会把塌掉的高度当成真实高度。
      const height = element.offsetHeight;
      if (height > 0 && (height !== settled.height || contentKey !== settled.key)) setSettled({ key: contentKey, height });
    };
    sync(true);
    const observer = new MutationObserver(() => sync(false));
    observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-query-state'] });
    return () => observer.disconnect();
  });
  const min = held ?? (contentKey !== settled.key && settled.height > 0 ? settled.height : undefined);
  return [ref, min === undefined ? undefined : { minHeight: min }];
}
