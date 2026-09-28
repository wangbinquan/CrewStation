import { useState } from 'react';
import { AlertDtoSchema, ClusterPageSchema, HealthDtoSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Stack } from '../../../shared/ui/Stack';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Badge } from '../../../shared/ui/Badge';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { runtimeDate } from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';
function ProjectHealth({ projectId }: { projectId: string }) {
  const t = useT();
  const health = useApiQuery(['runtime-service-health', projectId], async () => ({ items: HealthDtoSchema.array().parse((await api.observability.health(projectId)).items) }), AUTO_REFRESH);
  const alerts = useApiQuery(['runtime-service-alerts', projectId], async () => ({ items: AlertDtoSchema.array().parse((await api.observability.alerts(projectId)).items) }), AUTO_REFRESH);
  return <Stack><Card title={t('runtime.serviceHealth')} stacked><QueryStatus isPending={health.isPending} error={health.error} />{!health.error && health.data ? <div className={styles.grid}>{health.data.items.map((row) => <Card key={row.slot} title={t('runtime.slot.' + row.slot)} stacked>
    <Badge tone={row.state === 'healthy' ? 'success' : row.state === 'unknown' ? 'neutral' : 'warning'}>{t('runtime.health.' + row.state)}</Badge><p>{t('runtime.replicas')}: {row.state === 'unknown' ? '—' : `${row.readyReplicas} / ${row.replicas}`}</p><p>{t('runtime.restarts')}: {row.state === 'unknown' ? '—' : row.restarts}</p><p className={styles.hint}>{t('runtime.healthObserved')}</p><p className={styles.hint}>{t('runtime.healthRead', { at: runtimeDate(new Date(health.dataUpdatedAt).toISOString()) })}</p><p className={styles.hint}>{t('runtime.transition')}: {runtimeDate(row.lastTransitionAt)}</p>
  </Card>)}</div> : null}</Card>
    <Card title={t('runtime.serviceAlerts')} footer={t('runtime.alertScope')}><QueryStatus isPending={alerts.isPending} error={alerts.error} />{!alerts.error && alerts.data ? alerts.data.items.length ? <DataTable columns={[t('runtime.state'), t('runtime.reason'), t('runtime.start'), t('runtime.end')]}>{alerts.data.items.map((row) => <tr key={row.id}><td>{t('runtime.alert.' + row.state)}</td><td>{row.detail}</td><td>{runtimeDate(row.firedAt)}</td><td>{row.resolvedAt ? runtimeDate(row.resolvedAt) : '—'}</td></tr>)}</DataTable> : <EmptyState title={t('runtime.noAlerts')} /> : null}</Card>
    <Card title={t('runtime.serviceTelemetry')}><p className={styles.hint}>{t('runtime.serviceTelemetryHint')}</p></Card>
  </Stack>;
}
function PlatformHealth() {
  const t = useT(), [generation, setGeneration] = useState(0), [page, setPage] = useState<{ snapshotId?: string; cursor?: string }>({});
  const query = useApiQuery(['runtime-platform-pods', page, generation], async () => ClusterPageSchema.parse(await api.cluster.resources({ ...page, scope: 'system', view: 'pods', limit: 100 })), page.snapshotId ? { refetchOnWindowFocus: false } : AUTO_REFRESH), data = query.error ? undefined : query.data;
  return <Stack>{page.cursor ? <ActionRow><Button onClick={() => { setPage({}); setGeneration((value) => value + 1); }}>{t('runtime.firstResources')}</Button><p className={styles.hint}>{t('runtime.resourcePinned')}</p></ActionRow> : null}
    <Card title={t('runtime.platformHealth')} stacked footer={t('runtime.platformHealthHint')}><QueryStatus isPending={query.isPending} error={query.error} />{data ? <>
      {!data.complete ? <p role="status">{t('runtime.resourcePartial')}</p> : null}
      {data.items.length ? <DataTable columns={[t('runtime.component'), t('runtime.state'), t('runtime.restarts'), t('runtime.observed')]}>{data.items.map((row) => <tr key={row.uid}><td>{row.ownership.scope === 'system' ? row.ownership.component : row.name}<span className={styles.identity}>{row.namespace} / {row.name} · UID {row.uid}</span></td><td><Badge tone={row.abnormal ? 'warning' : row.ready && data.complete ? 'success' : 'neutral'}>{row.ready ? t('runtime.ready') : row.phase}</Badge><span className={styles.identity}>{row.reason}</span></td><td>{row.restarts}</td><td>{runtimeDate(row.observedAt)}</td></tr>)}</DataTable> : data.complete ? <EmptyState title={t('runtime.noResources')} /> : null}
      <p className={styles.hint}>{t(data.complete ? 'runtime.resourcePage' : 'runtime.resourcePartialPage', { shown: data.items.length, total: data.total })}</p>{data.nextCursor ? <Button onClick={() => setPage({ snapshotId: data.snapshotId, cursor: data.nextCursor })}>{t('runtime.nextResources')}</Button> : null}
    </> : null}</Card>
    <Card title={t('runtime.applicationTelemetry')}><p className={styles.hint}>{t('runtime.applicationTelemetryHint')}</p></Card>
  </Stack>;
}
export function RuntimeHealth({ projectId }: { projectId?: string }) { return projectId ? <ProjectHealth key={projectId} projectId={projectId} /> : <PlatformHealth />; }
