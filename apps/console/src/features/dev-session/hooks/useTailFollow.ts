import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';

/** 距底部这么多像素以内算“贴着底”，用户稍微滚一点不会立刻被判为要看历史。 */
const TAIL_THRESHOLD_PX = 40;

export interface TailFollow {
  /** 用户往上滚时停止跟随，滚回底部恢复。 */
  readonly onScroll: () => void;
  readonly following: boolean;
  readonly scrollToTail: () => void;
}

/**
 * 滚动容器跟随尾部：内容变化时自动滚到底，除非用户正在往上翻。
 * 容器 ref 由组件持有并传进来：hook 返回值里不放 ref，否则组件在渲染中读它会被 React 编译器判为越界。
 */
export function useTailFollow<T extends HTMLElement>(containerRef: RefObject<T | null>, dependency: unknown): TailFollow {
  const [following, setFollowing] = useState(true);

  const scrollToTail = useCallback(() => {
    const element = containerRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    setFollowing(true);
  }, [containerRef]);

  const onScroll = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight <= TAIL_THRESHOLD_PX);
  }, [containerRef]);

  useEffect(() => {
    const element = containerRef.current;
    if (element && following) element.scrollTop = element.scrollHeight;
  }, [containerRef, dependency, following]);

  return { onScroll, following, scrollToTail };
}
