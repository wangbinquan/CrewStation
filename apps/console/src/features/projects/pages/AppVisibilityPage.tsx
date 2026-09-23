import { useCallback } from 'react';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useManualRefresh } from '../../../shared/lib/useManualRefresh';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { Stack } from '../../../shared/ui/Stack';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { AppVisibilitySettings } from '../components/visibility/AppVisibilitySettings';

export function AppVisibilityPage({ embedded = false }: { readonly embedded?: boolean }) {
  const t = useT(), { projectId } = useProjectScope();
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  // 两份设置每 30 秒在原位重读；页面不提供刷新按钮（2026-09-23 裁定）。
  const visibility = useApiQuery(['app-visibility', me.data?.id, projectId], () => api.projects.getAppVisibility(projectId), { ...AUTO_REFRESH, enabled: Boolean(me.data) });
  const presentation = useApiQuery(['app-presentation', me.data?.id, projectId], () => api.projects.getAppPresentation(projectId), { ...AUTO_REFRESH, enabled: Boolean(me.data) });
  const { refetch: refetchVisibility } = visibility, { refetch: refetchPresentation } = presentation, { refetch: refetchMe } = me;
  const reload = useCallback(() => Promise.all([refetchMe(), refetchVisibility(), refetchPresentation()]), [refetchMe, refetchVisibility, refetchPresentation]);
  // 首次读取或读取失败才是“暂不能保存”；保存后的那次重读只暂停提交，不再闪出与“已保存”矛盾的提示（2026-09-16 实机）。
  // 例行重读不暂停提交，否则按钮每 30 秒变灰一次；只有保存后显式的重读（useManualRefresh）才算。
  const unavailable = me.isPending || visibility.isPending || presentation.isPending || Boolean(me.error || visibility.error || presentation.error);
  const { refresh: rereadAfterSave, refreshing } = useManualRefresh(reload);
  const canConfigure = Boolean(visibility.data?.canConfigure && (me.data?.isAdmin || me.data?.memberships?.some((membership) => membership.projectId === projectId && membership.role === 'owner')));
  return <Stack>
    {!embedded ? <PageHeader title={t('projects.visibility.title')} description={[t('projects.visibility.intro')]} /> : null}
    <QueryStatus isPending={me.isPending || visibility.isPending || presentation.isPending} error={me.error ?? visibility.error ?? presentation.error} />
    {visibility.data && presentation.data ? <AppVisibilitySettings key={`${me.data?.id}:${projectId}`} projectId={projectId} visibility={visibility.data} presentation={presentation.data} canConfigure={canConfigure} unavailable={unavailable} refreshing={refreshing} reload={rereadAfterSave} /> : null}
  </Stack>;
}
