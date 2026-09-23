import { ProjectSummariesPageSchema, ProjectSummaryDetailSchema, UserIdSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { usePollingRefetch } from '../../../shared/lib/usePollingRefetch';
import { useRecordRefresh } from '../../../shared/resources/useRecordRefresh';
import { useT } from '../../../shared/lib/useT';
import type { ProjectListSearch } from './projectListSearch';
import { useCallback } from 'react';

/** 每 30 秒先核对身份再静默重读摘要，界面不进入重读状态；页面不提供刷新按钮（2026-09-23 裁定）。 */
function useSummaryPolling(userId: string | undefined, readIdentity: () => Promise<{ data?: { id: string }; error: unknown }>,
  readSummary: (options: { cancelRefetch: boolean }) => Promise<unknown>, enabled: boolean): void {
  const reread = useCallback(async () => {
    const result = await readIdentity();
    if (!result.error && result.data?.id === userId) await readSummary({ cancelRefetch: false });
  }, [userId, readIdentity, readSummary]);
  usePollingRefetch(reread, 30_000, enabled);
}

export function useProjectSummaries(search: ProjectListSearch) {
  const t = useT(), me = useApiQuery(queryKeys.me(), () => api.me.get());
  const query = useApiQuery(queryKeys.projectSummaries(me.data?.id ?? '', search), async () => {
    const response = ProjectSummariesPageSchema.safeParse(await api.capabilities.projectSummaries({ ...search, ownerUserId: UserIdSchema.safeParse(search.ownerUserId).data, kind: ['DigitalWorker'], limit: 20 }));
    if (!response.success || response.data.items.length > 20 || response.data.items.some((item) => item.project.kind !== 'DigitalWorker') ||
      new Set(response.data.items.map((item) => item.project.id)).size !== response.data.items.length) throw new Error(t('projects.summary.invalid')); return response.data;
  }, { enabled: me.isSuccess && !me.error, staleTimeMs: 0 });
  useSummaryPolling(me.data?.id, me.refetch, query.refetch, me.isSuccess && !me.error);
  return { me, query };
}

/** 概览摘要随推送流立即重读的记录种类：槽（部署、副本、保留计时）、开发会话、构建与迁移（发布进度）。 */
const SUMMARY_KINDS = ['service-slot', 'dev-workspace', 'build-job', 'migration-job'] as const;

export function useProjectSummary(projectId: string) {
  const t = useT(), me = useApiQuery(queryKeys.me(), () => api.me.get());
  const query = useApiQuery(queryKeys.projectSummary(projectId, me.data?.id ?? ''), async () => {
    const response = ProjectSummaryDetailSchema.safeParse(await api.capabilities.projectSummary(projectId));
    if (!response.success || response.data.project.id !== projectId) throw new Error(t('projects.summary.invalid')); return response.data;
  }, { enabled: me.isSuccess && !me.error, staleTimeMs: 0 });
  useSummaryPolling(me.data?.id, me.refetch, query.refetch, me.isSuccess && !me.error);
  // RFC-025：这几种记录一变就静默重读摘要，不等 30 秒；30 秒的身份核对与重读照旧（成员与角色的变化靠它）。测试者读不到资源视图，不开。
  const { refetch } = query, reread = useCallback(() => refetch({ cancelRefetch: false }), [refetch]);
  useRecordRefresh(projectId, SUMMARY_KINDS, reread, { enabled: !!query.data && query.data.role !== 'tester' });
  return { me, query };
}
