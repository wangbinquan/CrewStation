import type { SlotDto } from '@crewstation/contracts';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';

/** 只读实际两槽及其 Release 的配置快照；不把当前取值版本当作已部署版本。 */
export function ProductionConfigImpact() {
  const t = useT(), { projectId, space } = useProjectScope(), client = useQueryClient();
  const project = useApiQuery(queryKeys.project(projectId), () => api.projects.get(projectId));
  const serviceId = project.data?.serviceId;
  const slots = useApiQuery(queryKeys.slots(serviceId ?? 'pending'), () => api.services.listSlots(serviceId!), { enabled: Boolean(serviceId) && !project.error });
  const versions = useApiQuery([...queryKeys.config(projectId, 'production'), 'versions'], () => api.config.listVersions(projectId, 'production'));
  const currentVersion = versions.isSuccess ? versions.data.items.reduce((latest, item) => Math.max(latest, item.version), 0) : undefined;
  const [refreshing, setRefreshing] = useState(false), lock = useRef(false);
  const refresh = async () => {
    if (lock.current) return; lock.current = true; setRefreshing(true);
    try {
      const [updatedSlots] = await Promise.all([serviceId ? slots.refetch() : Promise.resolve(undefined), project.refetch(), versions.refetch()]);
      await Promise.all((updatedSlots?.data?.items ?? []).filter((slot) => slot.releaseId).map((slot) => client.refetchQueries({ queryKey: queryKeys.release(slot.releaseId!), exact: true })));
    } finally { lock.current = false; setRefreshing(false); }
  };
  return <Card compact title={t('config.impact.title')} extra={<Button disabled={refreshing || project.isFetching || slots.isFetching || versions.isFetching} onClick={() => { void refresh(); }}>{t('config.impact.refresh')}</Button>}>
    <p>{t('config.impact.note')}</p>
    <QueryStatus isPending={project.isPending || Boolean(serviceId) && slots.isPending} error={project.error ?? slots.error} />
    <QueryStatus isPending={versions.isPending} error={versions.error} errorKey="config.error.versions" />
    <p>{currentVersion === undefined ? t('config.impact.currentUnknown') : t('config.impact.current', { version: currentVersion })}</p>
    {!project.isPending && !project.error && !serviceId ? <p>{t('config.impact.noService')}</p> : null}
    {serviceId && slots.isSuccess && !project.error ? <DataTable columns={[t('config.impact.slot'), t('config.impact.release'), t('config.impact.snapshot')]}>
      {(['prod', 'preview'] as const).map((name) => <ConfigSlotRow key={name} name={name} serviceId={serviceId} slot={slots.data.items.find((item) => item.name === name)} currentVersion={currentVersion} />)}
    </DataTable> : null}
    <Link to={PROJECT_PATHS[space].release} params={{ projectId }}>{t('config.impact.releases')}</Link>
  </Card>;
}

function ConfigSlotRow({ name, serviceId, slot, currentVersion }: { readonly name: 'prod' | 'preview'; readonly serviceId: string; readonly slot: SlotDto | undefined; readonly currentVersion: number | undefined }) {
  const t = useT(), releaseId = slot?.releaseId;
  const release = useApiQuery(queryKeys.release(releaseId ?? 'pending'), () => api.services.getRelease(releaseId!), { enabled: Boolean(releaseId) });
  const data = release.data;
  const matches = data?.id === releaseId && data?.serviceId === serviceId && (!slot?.commitSha || slot.commitSha === data?.commitSha);
  const version = matches && release.isSuccess ? data?.configVersion : undefined;
  let label = t('config.impact.slotUnknown');
  if (slot && !releaseId) label = t(slot.state === 'empty' ? 'config.impact.empty' : 'config.impact.slotUnknown');
  else if (releaseId && release.isPending) label = t('config.impact.loading');
  else if (releaseId && release.error) label = errorMessage(release.error);
  else if (releaseId && !matches) label = t('config.impact.mismatch');
  else if (data) label = `${data.tag} · ${data.commitSha.slice(0, 8)}`;
  return <tr><td>{t(`config.impact.${name}`)} {slot ? <Badge>{t(`config.impact.state.${slot.state}`)}</Badge> : null}</td><td>{label}</td><td>
    {slot?.state === 'empty' && !releaseId ? '—' : version === undefined ? t('config.impact.snapshotUnknown') : <>
      <span>{t('config.impact.recorded', { version })}</span>
      {currentVersion !== undefined ? <ActionNote tone="neutral">{t(version === currentVersion ? 'config.impact.same' : version < currentVersion ? 'config.impact.newerSaved' : 'config.impact.historyBehind')}</ActionNote> : null}
    </>}
  </td></tr>;
}
