import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useApiQuery } from '../api/useApi';
import { ProjectSummaryDetailSchema } from '@crewstation/contracts';

/** 只用于项目页面的可读名称；市场上下文不读取项目内部数据。 */
export function useProjectIdentity(projectId: string | undefined) {
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const previewOnly = me.data?.isAdmin !== true && !!me.data?.memberships?.some((member) => member.projectId === projectId && member.role === 'tester');
  const query = useApiQuery(queryKeys.projectIdentity(projectId ?? '', me.data?.id ?? '', previewOnly), async () => {
    if (!previewOnly) return api.projects.get(projectId!);
    const summary = ProjectSummaryDetailSchema.parse(await api.capabilities.projectSummary(projectId!));
    if (summary.project.id !== projectId) throw new Error('项目回执不匹配');
    return summary.project;
  // 路由切换可能先挂载对象边界，再完成市场重定向；试用成员也不能在这一帧读取项目摘要。
  }, { enabled: Boolean(projectId) && me.isSuccess && !me.error && (me.data?.platformRole === 'admin' || me.data?.platformRole === 'developer' && !previewOnly) });
  return { ...query, previewOnly, error: query.error ?? (!query.data ? me.error : null),
    isPending: !me.error && (me.isPending || query.isPending),
    refetch: async () => { const result = await me.refetch(); if (!result.error) await query.refetch(); } };
}
