// 「待回收的工作卷」（RFC-025 T13，I29 裁定 (3)）：上级已结束、平台不自动删的工作卷——业务任务的持久卷、保留期满的失败会话的卷、
// 集群里无主的卷。数据可能还有用，由管理员确认后删；删除经资源中心受理（期望改为「不要了」），调和器按 UID 删 PVC。
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ResourceRecord } from '@crewstation/contracts';
import { resourceCondition } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { ConfirmDialog } from '../../../shared/ui/dialog/ConfirmDialog';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import styles from './Cluster.module.css';

const volumeClaim = (record: ResourceRecord) => record.children.find((child) => child.kind === 'PersistentVolumeClaim');

/**
 * 待回收的卷：条件「待回收」为真、PVC 还在的工作卷记录。它们已按「已结束」算，要带上已结束的才读得到；PVC 删掉之后不再列出。
 * 已受理删除、PVC 还在删的留在列表里，按钮显示记录给的原因。
 */
export function reclaimableVolumes(records: readonly ResourceRecord[]): ResourceRecord[] {
  return records.filter((record) => record.kind === 'volume' && resourceCondition(record, 'PendingReclaim')?.status === 'true' && volumeClaim(record)?.phase !== 'absent');
}

export function ClusterReclaimVolumes({ projects }: { projects: readonly { readonly id: string; readonly name: string }[] }): ReactElement {
  const t = useT(), [target, setTarget] = useState<ResourceRecord>();
  const key = queryKeys.cluster('reclaim');
  const query = useApiQuery(key, () => api.resources.adminView({ kind: 'volume', includeStopped: 'true' }), { refetchIntervalMs: 15_000 });
  const rows = query.data ? reclaimableVolumes(query.data.items) : [];
  const remove = useApiMutation((record: ResourceRecord) => api.resources.act(record.id, 'delete-volume', { expectedVersion: record.version }), { invalidate: [key], onSuccess: () => setTarget(undefined) });
  const projectName = (id?: string) => projects.find((project) => project.id === id)?.name ?? id ?? '—';
  return <Card className={styles.listCard} title={t('cluster.reclaim.title', { count: query.data ? rows.length : '—' })} compact stacked>
    <p className={styles.muted}>{t('cluster.reclaim.hint')}</p>
    <QueryStatus isPending={query.isPending} error={query.error} isEmpty={!!query.data && rows.length === 0} emptyTitle={t('cluster.reclaim.empty')} />
    {rows.length ? <div className={styles.rows}><DataTable className={styles.table} stickyHeader columns={[t('cluster.reclaim.volume'), t('cluster.owner'), t('cluster.reason'), t('cluster.reclaim.since'), t('cluster.reclaim.action')]}>
      {rows.map((record) => {
        const pvc = volumeClaim(record), pending = resourceCondition(record, 'PendingReclaim'), action = record.actions.find((entry) => entry.id === 'delete-volume');
        return <tr key={record.id} data-reclaim-volume={record.id}><td>{pvc?.name ?? record.id}<small>{pvc ? `${pvc.namespace ?? ''} · ${pvc.phase}` : ''}</small></td><td>{projectName(record.projectId)}</td><td><span className={styles.reason}>{pending?.message ?? '—'}</span></td><td>{pending ? new Date(pending.since).toLocaleString() : '—'}</td>
          <td><div className={styles.action}><Button variant="danger" size="small" onClick={() => { remove.reset(); setTarget(record); }} disabled={!action?.enabled || remove.isPending}>{t('cluster.ledger.action.delete-volume')}</Button>{action && !action.enabled && action.disabledReason ? <small className={styles.muted}>{action.disabledReason}</small> : null}</div></td></tr>;
      })}
    </DataTable></div> : null}
    {target ? <ConfirmDialog title={t('cluster.ledger.action.delete-volume')} question={t('cluster.reclaim.confirm', { name: volumeClaim(target)?.name ?? target.id, project: projectName(target.projectId) })} confirmWord="delete" confirmLabel={t('cluster.confirm')} cancelLabel={t('cluster.cancel')}
      busy={remove.isPending} onConfirm={() => remove.mutate(target)} onCancel={() => { setTarget(undefined); remove.reset(); }}>
      <p>{t('cluster.reclaim.consequence')}</p>
      <QueryStatus isPending={false} error={remove.error} />
    </ConfirmDialog> : null}
  </Card>;
}
