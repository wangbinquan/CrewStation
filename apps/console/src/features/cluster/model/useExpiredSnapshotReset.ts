import { useEffect, useRef } from 'react';

/**
 * 读取用的快照或指标分页过期（410，后端只保留 10 分钟）时自动回到最新一份的第一页，
 * 不再给「读取最新快照」按钮（2026-09-23 裁定：页面自动局部刷新，不提供刷新按钮）。
 * 回调经 ref 取最新一版：只在过期出现的那一刻重置一次，不随每次渲染重跑。
 */
export function useExpiredSnapshotReset(expired: boolean, reset: () => void): void {
  const latest = useRef(reset);
  useEffect(() => { latest.current = reset; });
  useEffect(() => { if (expired) latest.current(); }, [expired]);
}
