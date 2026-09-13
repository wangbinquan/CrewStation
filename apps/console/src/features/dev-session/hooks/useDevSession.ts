import type { ReleaseDevSessionResult } from '@crewstation/api-client';
import type { DevSessionDto } from '@crewstation/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import type { ApiClientError } from '../../../shared/api/useApi';

export interface DevSessionHandle {
  readonly session: DevSessionDto | undefined;
  readonly isPending: boolean;
  /** 没有会话不是错误：GET 返回 404 就是“还没开”。 */
  readonly missing: boolean;
  readonly loadError: ApiClientError | null;
  readonly open: UseMutationResult<DevSessionDto, ApiClientError, string>;
  readonly release: UseMutationResult<ReleaseDevSessionResult, ApiClientError, boolean>;
}

/** 会话本体：读取、开会话、释放。释放结果里的未推送提交由调用方展示。 */
export function useDevSession(projectId: string): DevSessionHandle {
  const key = queryKeys.devSession(projectId);
  const query = useApiQuery(key, () => api.devSession.get(projectId), { refetchIntervalMs: 10_000 });
  // 释放之后重新取会得到 404，而 React Query 仍留着上一次成功的数据；
  // 已释放的会话也不算活着。两种情况都按“没有会话”处理，否则会同时渲染工作区与开会话表单。
  const absent = query.error?.kind === 'not_found' || query.data?.state === 'released';
  return {
    session: absent ? undefined : query.data,
    isPending: query.isPending,
    missing: absent,
    loadError: absent ? null : query.error,
    open: useApiMutation((branch: string) => api.devSession.open(projectId, { branch }), { invalidate: [key] }),
    release: useApiMutation((force: boolean) => api.devSession.release(projectId, { force, ...(query.data ? { expectedTaskId: query.data.taskId } : {}) }), { invalidate: [key] }),
  };
}
