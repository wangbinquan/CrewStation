import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ProfileTestDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { usePollingRefetch } from '../../../shared/lib/usePollingRefetch';
import { testRunning } from '../model/profileStatus';

/**
 * 手动重测：每次发起换一个 clientRequestId（双击与断线重发只查回原测试），按 testId 轮询到终态；
 * 终态后让详情与列表重读，档位的可用性随之更新。页面展示「最近一次」：手动发起的与保存后自动排的取较新者。
 */
export function useProfileTest(name: string, latest: ProfileTestDto | undefined) {
  const queryClient = useQueryClient();
  const [testId, setTestId] = useState<string | undefined>(undefined);
  const [requestId, setRequestId] = useState<string>(() => crypto.randomUUID());
  const followed = useApiQuery(queryKeys.profileTest(name, testId ?? ''), () => api.computeProfiles.getTest(name, testId!), { enabled: testId !== undefined });
  const start = useApiMutation(() => api.computeProfiles.startTest(name, { clientRequestId: requestId }), {
    onSuccess: (result: ProfileTestDto) => { queryClient.setQueryData(queryKeys.profileTest(name, result.testId), result); setTestId(result.testId); setRequestId(crypto.randomUUID()); },
  });
  const manual = followed.data;
  const finished = manual !== undefined && !testRunning(manual);
  usePollingRefetch(followed.refetch, 2000, testId !== undefined && !finished);
  useEffect(() => {
    if (finished) void queryClient.invalidateQueries({ queryKey: queryKeys.computeProfiles() });
  }, [finished, manual?.testId, queryClient]);
  const shown = manual !== undefined && (latest === undefined || manual.createdAt >= latest.createdAt) ? manual : latest;
  return { shown, start, running: start.isPending || testRunning(shown), error: start.error ?? followed.error };
}
