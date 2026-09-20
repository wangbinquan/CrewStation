import { useCallback } from 'react';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { AppVisibilitySettings } from '../components/visibility/AppVisibilitySettings';

export function AppVisibilityPage({ embedded = false }: { readonly embedded?: boolean }) {
  const t = useT(), { projectId } = useProjectScope();
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const visibility = useApiQuery(['app-visibility', me.data?.id, projectId], () => api.projects.getAppVisibility(projectId), { enabled: Boolean(me.data) });
  const presentation = useApiQuery(['app-presentation', me.data?.id, projectId], () => api.projects.getAppPresentation(projectId), { enabled: Boolean(me.data) });
  const { refetch: refetchVisibility } = visibility, { refetch: refetchPresentation } = presentation, { refetch: refetchMe } = me;
  const reload = useCallback(() => Promise.all([refetchMe(), refetchVisibility(), refetchPresentation()]), [refetchMe, refetchVisibility, refetchPresentation]);
  // 首次读取或读取失败才是“暂不能保存”；保存后的后台重读只暂停提交，不再闪出与“已保存”矛盾的提示（2026-09-16 实机）。
  const unavailable = me.isPending || visibility.isPending || presentation.isPending || Boolean(me.error || visibility.error || presentation.error);
  const refreshing = me.isFetching || visibility.isFetching || presentation.isFetching;
  const canConfigure = Boolean(visibility.data?.canConfigure && (me.data?.isAdmin || me.data?.memberships?.some((membership) => membership.projectId === projectId && membership.role === 'owner')));
  return <>
    {!embedded ? <PageHeader title={t('projects.visibility.title')} description={[t('projects.visibility.intro')]} actions={<Button onClick={() => { void reload(); }}>{t('projects.visibility.refresh')}</Button>} /> : <Button onClick={() => { void reload(); }}>{t('projects.visibility.refresh')}</Button>}
    <QueryStatus isPending={me.isPending || visibility.isPending || presentation.isPending} error={me.error ?? visibility.error ?? presentation.error} />
    {visibility.data && presentation.data ? <AppVisibilitySettings key={`${me.data?.id}:${projectId}`} projectId={projectId} visibility={visibility.data} presentation={presentation.data} canConfigure={canConfigure} unavailable={unavailable} refreshing={refreshing} reload={reload} /> : null}
  </>;
}
