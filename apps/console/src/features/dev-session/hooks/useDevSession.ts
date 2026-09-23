import type { ReleaseDevSessionResult } from '@crewstation/api-client';
import type { DevSessionDto, OpenDevSessionRequest } from '@crewstation/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { isApiClientError, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { progressPollMs, stampReceived } from '../../../shared/ui/progress/stageProgressView';
import type { ApiClientError } from '../../../shared/api/useApi';

export interface DevSessionHandle {
  readonly session: DevSessionDto | undefined;
  readonly isPending: boolean;
  /** 没有会话不是错误：GET 返回 404 就是“还没开”。 */
  readonly missing: boolean;
  readonly loadError: ApiClientError | null;
  /** 传分支开新会话；按原分支重新开始时连同失败的那个会话一起传（restartOf）。 */
  readonly open: UseMutationResult<DevSessionDto, ApiClientError, string | OpenDevSessionRequest>;
  readonly release: UseMutationResult<ReleaseDevSessionResult, ApiClientError, boolean>;
}

/** 会话本体：读取、开会话、释放。释放结果里的未推送提交由调用方展示。 */
export function useDevSession(projectId: string): DevSessionHandle {
  const t = useT(), key = queryKeys.devSession(projectId);
  // 404 是“还没开”，作为数据（null）而不是错误留在缓存里：没有数据的查询每次重取（10 秒轮询、目录面板再次订阅同一键）
  // 都会被库置回 pending 并清掉错误，开会话表单会每 10 秒卸载一次、参考面板在会话未知时来回挂载。
  // 没有 taskId 的响应不是会话：整页工作区都挂在 taskId 上（任务流地址、个人布局），当成会话会让页面在连流时崩掉。
  const query = useApiQuery<DevSessionDto | null>(key, async () => {
    try {
      const data = await api.devSession.get(projectId);
      if (typeof data?.taskId !== 'string') throw new Error(t('devSession.invalidResponse'));
      return data.startup ? { ...data, startup: stampReceived(data.startup, Date.now())! } : data;
    }
    catch (error) { if (isApiClientError(error) && error.kind === 'not_found') return null; throw error; }
    // 开始开发或重建期间每秒读一次（RFC-022 B9）：Runner 连上之前没有推送，阶段靠读。
  }, { refetchIntervalMs: (data) => progressPollMs([data?.startup], 1_000, 10_000) });
  // 每 10 秒的例行重取不改界面；页面没有「检查状态」按钮（2026-09-23 裁定：自动局部刷新，读取失败自动重试）。
  // 同一查询键也被目录面板的会话绑定订阅，它的取数函数把 404 当错误；已释放的会话也不算活着。三种情况都按“没有会话”处理，
  // 否则会同时渲染工作区与开会话表单。
  const absent = query.data === null || query.error?.kind === 'not_found' || query.data?.state === 'released';
  // 读取失败（非 404）后的每次重取同样会把状态置回 pending：只有第一次读取算“读取中”，否则页面在“读取中”与失败之间来回切换，
  // 参考面板随之反复挂载并再次触发重取。
  const firstLoad = query.isPending && !query.isFetched;
  return {
    session: absent ? undefined : query.data ?? undefined,
    isPending: firstLoad,
    missing: absent,
    loadError: absent ? null : query.error,
    open: useApiMutation((input: string | OpenDevSessionRequest) => api.devSession.open(projectId, typeof input === 'string' ? { branch: input } : input), { invalidate: [key] }),
    release: useApiMutation((force: boolean) => api.devSession.release(projectId, { force, ...(query.data ? { expectedTaskId: query.data.taskId } : {}) }), { invalidate: [key] }),
  };
}
