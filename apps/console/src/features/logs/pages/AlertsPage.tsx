import { AlertDtoSchema } from '@crewstation/contracts';
import type { SlotName } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { usePolledRefresh } from '../../../shared/lib/useManualRefresh';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import type { OperationsSearch } from '../../../shared/project/operationsSearch';
import { Card } from '../../../shared/ui/Card';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { DataTable } from '../../../shared/ui/DataTable';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { AlertSubscriptionsCard } from '../components/AlertSubscriptionsCard';
import styles from '../components/Alerts.module.css';

export function AlertsPage({ projectId, search, change, onLogs }: { readonly projectId: string; readonly search: OperationsSearch; readonly change: (next: OperationsSearch) => void; readonly onLogs: (slot: SlotName) => void }) {
  const t = useT(), date = useDateText();
  const alerts = useApiQuery(queryKeys.alerts(projectId), async () => {
    const response = await api.observability.alerts(projectId), parsed = AlertDtoSchema.array().safeParse(response.items);
    if (!parsed.success || parsed.data.some((row) => row.projectId !== projectId)) throw new Error(t('logs.alerts.mismatch')); return { items: parsed.data };
  });
  const { refresh, refreshing } = usePolledRefresh(alerts.refetch, 5_000);
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const canManage = !me.error && !!me.data && (me.data.isAdmin || me.data.memberships?.some((member) => member.projectId === projectId && member.role === 'owner') === true);
  const rows = !alerts.error ? alerts.data?.items ?? [] : [], filter = search.alertState ?? 'all';
  const shown = rows.filter((row) => filter === 'all' || row.state === filter), selected = rows.find((row) => row.id === search.alertId);
  return <div className={styles.stack}>
    <Card compact title={t('logs.alerts.title')} extra={<Button disabled={refreshing} onClick={() => void refresh()}>{t('logs.alerts.refresh')}</Button>} footer={t('logs.alerts.recent')}>
      <div className={styles.tools}>{(['all', 'firing', 'resolved'] as const).map((state) => <Button key={state} variant={state === filter ? 'secondary' : 'ghost'} aria-pressed={state === filter} onClick={() => change({ ...search, tab: 'alerts', alertState: state })}>{t(`logs.alerts.state.${state}`)}</Button>)}</div>
      <QueryStatus isPending={alerts.isPending} error={alerts.error} />
      {!alerts.isPending && !alerts.error && !shown.length ? <p>{t(rows.length ? 'logs.alerts.filteredEmpty' : 'logs.alerts.empty')}</p> : null}
      {shown.length ? <DataTable columns={[t('logs.alerts.type'), t('logs.alerts.state'), t('logs.alerts.detail'), t('logs.alerts.firedAt')]}>
        {shown.map((row) => <tr key={row.id}><td><Button aria-pressed={row.id === search.alertId} onClick={() => change({ ...search, tab: 'alerts', alertId: row.id })}>{t(`logs.alerts.type.${row.type}`)}</Button></td><td><Badge tone={row.state === 'firing' ? 'danger' : 'neutral'}>{t(`logs.alerts.state.${row.state}`)}</Badge></td><td className={styles.detail}>{row.detail}</td><td>{date(row.firedAt)}</td></tr>)}
      </DataTable> : null}
    </Card>
    {search.alertId ? <Card compact title={t('logs.alerts.selected')} extra={<Button onClick={() => change({ ...search, alertId: undefined })}>{t('logs.alerts.closeDetail')}</Button>}>
      <code>{search.alertId}</code>
      {!selected ? <ActionNote tone="neutral">{t(alerts.error || alerts.isPending ? 'logs.alerts.unconfirmed' : 'logs.alerts.notFound')}</ActionNote> : <>
        <DefinitionList items={[{ label: t('logs.alerts.type'), value: t(`logs.alerts.type.${selected.type}`) }, { label: t('logs.alerts.state'), value: t(`logs.alerts.state.${selected.state}`) }, { label: t('logs.alerts.firedAt'), value: date(selected.firedAt) }, ...(selected.state === 'resolved' ? [{ label: t('logs.alerts.resolvedAt'), value: selected.resolvedAt ? date(selected.resolvedAt) : t('logs.alerts.unconfirmed') }] : [])]} />
        <p className={styles.detail}>{selected.detail}</p>
        {selected.slot ? <><p>{t('logs.alerts.currentLogsHint')}</p><Button onClick={() => onLogs(selected.slot!)}>{t(`logs.alerts.logs.${selected.slot}`)}</Button></> : <p>{t('logs.alerts.noTarget')}</p>}
      </>}
    </Card> : null}
    <AlertSubscriptionsCard projectId={projectId} canManage={canManage} />
  </div>;
}
