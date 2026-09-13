import { useEffect } from 'react';
import type { ComparisonTarget } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import type { TaskStreamChannel } from './useTaskStream';
import { useT } from '../../../shared/lib/useT';

/** 进入／回到前台重查，每 10 秒核验实际目标版本；文件变更去抖，隐藏页面不轮询。 */
export function useVersionComparison(projectId: string, taskId: string, channel: TaskStreamChannel, target: ComparisonTarget = 'prod') {
  const t = useT(), key = [...queryKeys.versionComparison(projectId, taskId), target];
  const query = useApiQuery(key, async () => {
    const result = await api.devSession.versionComparison(projectId, target);
    if (result.taskId !== taskId || result.deployment?.target !== target) throw new Error(t('devSession.compare.invalidTarget'));
    return result;
  }, { refetchIntervalMs: 10_000, staleTimeMs: 0, refetchOnWindowFocus: true });
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
  const history = useApiMutation(() => api.devSession.refreshComparisonHistory(projectId, target), { invalidate: [key] });
  return { query, history };
}
