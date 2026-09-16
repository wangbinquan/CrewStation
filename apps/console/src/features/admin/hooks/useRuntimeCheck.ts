import { useState } from 'react';
import type { RuntimeCheckDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';

const RUNNING = new Set(['queued', 'running']);

/** 检查：固定 revision＋clientRequestId 发起，按 checkId 轮询到终态；断线后按 ID 恢复，不重复发起。 */
export function useRuntimeCheck(configId: string, initialCheckId?: string) {
  const [checkId, setCheckId] = useState<string | undefined>(initialCheckId);
  const [requestId, setRequestId] = useState<string>(() => crypto.randomUUID());
  const check = useApiQuery(queryKeys.runtimeCheck(configId, checkId ?? ''), () => api.agentRuntime.getCheck(configId, checkId!), { enabled: checkId !== undefined, refetchIntervalMs: 2000 });
  const running = check.data ? RUNNING.has(check.data.state) : false;
  const start = useApiMutation((input: { revision: number; model?: string }) => api.agentRuntime.startCheck(configId, { revision: input.revision, clientRequestId: requestId, ...(input.model ? { model: input.model } : {}) }), {
    onSuccess: (result: RuntimeCheckDto) => { setCheckId(result.checkId); setRequestId(crypto.randomUUID()); },
  });
  return { checkId, check, running: running || start.isPending, start, follow: (id: string) => setCheckId(id) };
}
