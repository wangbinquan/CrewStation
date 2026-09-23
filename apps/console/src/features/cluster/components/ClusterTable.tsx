import type { ClusterResource, ClusterUsage } from '@crewstation/contracts';
import { Link } from '@tanstack/react-router';
import { useT } from '../../../shared/lib/useT';
import { DataTable } from '../../../shared/ui/DataTable';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { amount, MetricValue } from './MetricValue';
import styles from './Cluster.module.css';
export function Ownership({ row }: { row: ClusterResource }) {
  const t = useT(), owner = row.ownership;
  return owner.scope === 'project' ? <span><Link to="/projects/$projectId" params={{ projectId: owner.projectId }}>{owner.projectName}</Link>{owner.archived ? ` · ${t('cluster.archived')}` : ''}</span> : owner.scope === 'system' ? <span>{t('cluster.system')} · {owner.component}</span> : <span title={owner.reason}>{t('cluster.unresolved')}</span>;
}
export function ClusterTable({ rows, select, usages = [] }: { rows: ClusterResource[]; usages?: ClusterUsage[]; select: (row: ClusterResource) => void }) {
  const t = useT(), pods = rows.length > 0 && rows.every((r) => r.kind === 'Pod');
  return <DataTable className={styles.table} columns={[t('cluster.resource'), t('cluster.owner'), t('cluster.purpose'), t('cluster.status'), t('cluster.ready'), t('cluster.location'), ...(pods ? [t('cluster.container'), t('cluster.metrics.cpuRequestActual'), t('cluster.metrics.memoryRequestActual')] : [])]}>
    {rows.map((r) => { const usage = usages.find((u) => u.resourceId === r.resourceId && u.uid === r.uid); return <tr key={r.uid}><td><Button variant="ghost" size="small" data-cluster-resource={r.resourceId} onClick={() => select(r)}>{r.name}</Button><small>{r.kind}</small></td><td><Ownership row={r} /></td><td>{t(`cluster.purpose.${r.purpose}`)}{r.slotRole ? <small>{r.physicalSlot} · {r.slotRole}</small> : null}</td><td><Badge tone={r.abnormal ? 'danger' : r.deletingAt ? 'warning' : 'neutral'}>{r.deletingAt ? t('cluster.terminating') : r.phase}</Badge>{r.reason ? <small className={styles.reason} title={r.reason}>{r.reason}</small> : null}</td><td>{r.kind === 'Pod' ? r.ready ? t('cluster.yes') : t('cluster.no') : r.desired === undefined ? '—' : `${r.readyReplicas ?? 0}/${r.desired}`}{r.restarts > 0 ? <small>{t('cluster.restarts', { count: r.restarts })}</small> : null}</td><td>{r.namespace || '—'}{r.node ? <small>{r.node}</small> : null}</td>{pods ? <><td>{r.containers.length}</td><td>{amount(usage?.demand.requests.cpu, 'cores')}<small><MetricValue metric={usage?.metrics.cpu} compact /></small></td><td>{amount(usage?.demand.requests.memory)}<small><MetricValue metric={usage?.metrics.memory} compact /></small></td></> : null}</tr>; })}
  </DataTable>;
}
