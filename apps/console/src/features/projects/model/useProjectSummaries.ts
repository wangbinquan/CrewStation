import { ProjectSummariesPageSchema, ProjectSummaryDetailSchema, UserIdSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useManualRefresh } from '../../../shared/lib/useManualRefresh';
import { usePollingRefetch } from '../../../shared/lib/usePollingRefetch';
import { useT } from '../../../shared/lib/useT';
import type { ProjectListSearch } from './projectListSearch';
import { useCallback } from 'react';

/** 例行重读静默进行：只有用户点的刷新才让页面进入重读状态，否则入口每 30 秒都要闪一次。 */
function useSummaryRefresh(userId: string | undefined, readIdentity: () => Promise<{ data?: { id: string }; error: unknown }>,
  readSummary: (options: { cancelRefetch: boolean }) => Promise<unknown>, enabled: boolean) {
  const reread = useCallback(async () => {
    const result = await readIdentity();
    if (!result.error && result.data?.id === userId) await readSummary({ cancelRefetch: false });
  }, [userId, readIdentity, readSummary]);
  const { refresh, refreshing } = useManualRefresh(reread);
  usePollingRefetch(reread, 30_000, enabled); return { refresh, refreshing };
}

export function useProjectSummaries(search: ProjectListSearch) {
  const t = useT(), me = useApiQuery(queryKeys.me(), () => api.me.get());
  const query = useApiQuery(queryKeys.projectSummaries(me.data?.id ?? '', search), async () => {
    const response = ProjectSummariesPageSchema.safeParse(await api.capabilities.projectSummaries({ ...search, ownerUserId: UserIdSchema.safeParse(search.ownerUserId).data, kind: ['DigitalWorker'], limit: 20 }));
    if (!response.success || response.data.items.length > 20 || response.data.items.some((item) => item.project.kind !== 'DigitalWorker') ||
      new Set(response.data.items.map((item) => item.project.id)).size !== response.data.items.length) throw new Error(t('projects.summary.invalid')); return response.data;
  }, { enabled: me.isSuccess && !me.error, staleTimeMs: 0 });
  const { refresh, refreshing } = useSummaryRefresh(me.data?.id, me.refetch, query.refetch, me.isSuccess && !me.error);
  return { me, query, refresh, refreshing };
}

export function useProjectSummary(projectId: string) {
  const t = useT(), me = useApiQuery(queryKeys.me(), () => api.me.get());
  const query = useApiQuery(queryKeys.projectSummary(projectId, me.data?.id ?? ''), async () => {
    const response = ProjectSummaryDetailSchema.safeParse(await api.capabilities.projectSummary(projectId));
    if (!response.success || response.data.project.id !== projectId) throw new Error(t('projects.summary.invalid')); return response.data;
  }, { enabled: me.isSuccess && !me.error, staleTimeMs: 0 });
  const { refresh, refreshing } = useSummaryRefresh(me.data?.id, me.refetch, query.refetch, me.isSuccess && !me.error);
  return { me, query, refresh, refreshing };
}
