import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { usePollingRefetch } from '../../../shared/lib/usePollingRefetch';
import { useT } from '../../../shared/lib/useT';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { retryProvisioning } from '../model/provisionRequest';

/** project.state 不等于首个 Release 已部署，不能据它显示完整链路全绿。 */
export function ProjectProvisioningPage({ projectId }: { projectId: string }) {
  const t = useT(), busy = useRef(false);
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const [retryWatch, setRetryWatch] = useState(false);
  const project = useApiQuery(queryKeys.project(projectId), () => api.projects.get(projectId));
  const retry = useApiMutation(() => retryProvisioning(projectId), { invalidate: [queryKeys.projects()], onSuccess: () => setRetryWatch(true) });
  useEffect(() => { if (!retryWatch) return; const timer = setTimeout(() => setRetryWatch(false), 60_000); return () => clearTimeout(timer); }, [retryWatch]);
  usePollingRefetch(project.refetch, 5000, project.data?.state === 'provisioning' || (retryWatch && project.data?.state === 'failed'));
  const requeue = async () => {
    if (busy.current || project.error) return;
    busy.current = true;
    try { await retry.mutateAsync(); } catch { /* 保留失败内容与原状态供重试。 */ } finally { busy.current = false; }
  };
  const item = project.data, paths = PROJECT_PATHS[item?.kind === 'DigitalWorker' ? 'workbench' : 'admin'];
  return <Card stacked compact title={t('projects.provision.title')} extra={<Button disabled={project.isFetching || retry.isPending} onClick={() => void project.refetch()}>{t('projects.provision.refresh')}</Button>}>
    <QueryStatus isPending={project.isPending} error={project.error} loadingKey="projects.overview.loading" errorKey="projects.overview.error" />
    {item && !project.error ? <>
      <DefinitionList layout="grid" items={[{ label: t('projects.self.projectId'), value: item.id }, { label: t('projects.create.name'), value: item.name }, { label: t('projects.create.slug'), value: item.slug },
        { label: t('projects.list.columnState'), value: <Badge tone={item.state === 'failed' ? 'warning' : 'info'}>{t(`projects.state.${item.state}`)}</Badge> }]} />
      <ActionNote tone={item.state === 'failed' ? 'error' : 'neutral'}>{t(`projects.provision.${item.state}`)}</ActionNote>
      {item.message ? <ActionNote tone="error">{item.message}</ActionNote> : null}
      {item.state === 'failed' && !me.error && (me.data?.platformRole === 'admin' || me.data?.id === item.ownerUserId) ? <Button disabled={retry.isPending} onClick={() => void requeue()}>{t(retry.isPending ? 'projects.list.retrying' : 'projects.list.retryProvision')}</Button> : null}
      <p><Link to={paths.settings} params={{ projectId }} search={{ tab: 'config', env: 'production' }}>{t('projects.provision.config')}</Link> · <Link to={paths.release} params={{ projectId }}>{t('projects.provision.release')}</Link> · <Link to={paths.development} params={{ projectId }}>{t('projects.provision.development')}</Link></p>
      {item.kind === 'DigitalWorker' ? <Link to="/projects">{t('projects.provision.backProjects')}</Link> : <Link to="/admin/capabilities" search={{ tab: 'integrations' }}>{t('nav.admin.backToIntegrations')}</Link>}
    </> : null}
    {retry.isError ? <ActionNote tone="error">{t('projects.list.retryFailed', { message: errorMessage(retry.error) })}</ActionNote> : null}
    {retry.isSuccess ? <ActionNote tone="success">{t('projects.provision.queued')}</ActionNote> : null}
  </Card>;
}
