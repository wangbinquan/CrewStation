// 量容器宽度：形态图按容器宽度铺满（作者 2026-09-22 裁定界面宽度必须用满），不留固定像素的空白。
import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export function useContainerWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const sync = () => setWidth(Math.floor(element.clientWidth));
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
