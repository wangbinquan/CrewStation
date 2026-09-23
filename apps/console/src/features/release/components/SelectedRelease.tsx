import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { ReleaseStatusBadge } from './ReleaseStatusBadge';
import { isInFlight } from '../model/releaseStatus';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';

/**
 * 选中的发布；可以重新部署的发布给负责人与管理员一个「重新部署到待验证版本」（RFC-021 M5）。
 * 进行中的发布每 5 秒、其余每 30 秒在原位重读；动作在卡片底部操作条，重新部署是主动作。
 */
export function SelectedRelease({ releaseId, serviceId, onRedeploy }: { readonly releaseId: string; readonly serviceId: string; readonly onRedeploy?: (releaseId: string) => void }) {
  const t = useT(), { projectId, space } = useProjectScope();
  const query = useApiQuery(queryKeys.release(releaseId), () => api.services.getRelease(releaseId), { refetchIntervalMs: (data) => (data && isInFlight(data.status) ? 5_000 : AUTO_REFRESH.refetchIntervalMs), refetchOnWindowFocus: true });
  const release = query.data?.id === releaseId && query.data.serviceId === serviceId && !query.error ? query.data : undefined;
  const actions = release ? <>
    {onRedeploy && release.redeployable ? <Button variant="primary" onClick={() => onRedeploy(release.id)}>{t('release.redeploy.fromDetail')}</Button> : null}
    {(['build', 'migration'] as const).map((source) => <ButtonLink key={source} to={PROJECT_PATHS[space].operations} params={{ projectId }} search={{ tab: 'logs', source, releaseId }}>{t(`release.detail.logs.${source}`)}</ButtonLink>)}
  </> : undefined;
  return <Card compact title={t('release.detail.title')} actions={actions}>
    <code>{releaseId}</code><QueryStatus isPending={query.isPending} error={query.error} />
    {query.data && !release && !query.error ? <ActionNote tone="error">{t('release.detail.mismatch')}</ActionNote> : null}
    {release ? <>
      <DefinitionList items={[{ label: t('release.history.columnTag'), value: release.tag }, { label: t('release.prepare.sha'), value: <code>{release.commitSha}</code> }, { label: t('release.publish.branch'), value: release.branch }, { label: t('release.history.columnStatus'), value: <ReleaseStatusBadge status={release.status} /> }]} />
      <p>{t(`release.detail.${release.status}`)}</p>{release.message ? <ActionNote tone={release.status === 'failed' ? 'error' : 'neutral'}>{release.message}</ActionNote> : null}
    </> : null}
  </Card>;
}
