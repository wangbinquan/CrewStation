import { useCallback } from 'react';
import { projectRoute } from '../../../app/router/projectRoute';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { AppPresentationForm } from '../components/visibility/AppPresentationForm';
import { AppVisibilityForm } from '../components/visibility/AppVisibilityForm';
import { VisibilityCheck } from '../components/visibility/VisibilityCheck';
import styles from '../components/visibility/Visibility.module.css';

export function AppVisibilityPage() {
  const t = useT(), { projectId } = projectRoute.useParams();
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const visibility = useApiQuery(['app-visibility', me.data?.id, projectId], () => api.projects.getAppVisibility(projectId), { enabled: Boolean(me.data) });
  const presentation = useApiQuery(['app-presentation', me.data?.id, projectId], () => api.projects.getAppPresentation(projectId), { enabled: Boolean(me.data) });
  const { refetch: refetchVisibility } = visibility, { refetch: refetchPresentation } = presentation;
  const reload = useCallback(() => Promise.all([refetchVisibility(), refetchPresentation()]), [refetchVisibility, refetchPresentation]);
  return <>
    <PageHeader title={t('projects.visibility.title')} description={[t('projects.visibility.intro')]} actions={<Button onClick={() => { void reload(); }}>{t('projects.visibility.refresh')}</Button>} />
    <QueryStatus isPending={me.isPending || visibility.isPending || presentation.isPending} error={me.error ?? visibility.error ?? presentation.error} />
    <div className={styles.stack}>{visibility.data ? <Card compact title={t('projects.visibility.scope')}><AppVisibilityForm key={projectId} projectId={projectId} saved={visibility.data} reload={reload} /></Card> : null}
    {presentation.data && visibility.data ? <Card compact title={t('projects.visibility.presentation')}><AppPresentationForm key={projectId} projectId={projectId} saved={presentation.data} canConfigure={visibility.data.canConfigure} reload={reload} /></Card> : null}
    {visibility.data?.canConfigure && !visibility.error ? <Card compact title={t('projects.visibility.check')}><VisibilityCheck projectId={projectId} revision={visibility.data.revision} /></Card> : null}</div>
  </>;
}
