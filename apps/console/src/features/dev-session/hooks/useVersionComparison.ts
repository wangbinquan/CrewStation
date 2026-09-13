import { useEffect } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import type { TaskStreamChannel } from './useTaskStream';

/** 前台每 10 秒核验真实 Git／生产来源，保存文件去抖刷新；隐藏页面不轮询。 */
export function useVersionComparison(projectId: string, taskId: string, channel: TaskStreamChannel) {
  const key = queryKeys.versionComparison(projectId, taskId);
  const query = useApiQuery(key, () => api.devSession.versionComparison(projectId), { refetchIntervalMs: 10_000 });
  const { refetch } = query;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = channel.subscribe((event) => {
      if (event.kind !== 'fileChanged') return;
      clearTimeout(timer);
      timer = setTimeout(() => { if (document.visibilityState !== 'hidden') void refetch(); }, 400);
    });
    return () => { unsubscribe(); clearTimeout(timer); };
  }, [channel, refetch]);
  const history = useApiMutation(() => api.devSession.refreshComparisonHistory(projectId), { invalidate: [key] });
  return { query, history };
}
