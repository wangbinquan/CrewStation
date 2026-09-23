import { useState } from 'react';
import type { ClusterNode } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { MetricValue, amount } from './MetricValue';
import { ResourceBudgetTable } from './ResourceBudgetTable';
import { ClusterHistory } from './ClusterHistory';
import { useExpiredSnapshotReset } from '../model/useExpiredSnapshotReset';
import styles from './Metrics.module.css';

export function ClusterNodes({ selectPod }: { selectPod: (id: string) => void }) {
  const t = useT(), [cursor, setCursor] = useState(0), [observationId, setObservationId] = useState<string>(), [selected, setSelected] = useState<string>();
  const query = useApiQuery(queryKeys.cluster('nodes', [cursor, observationId]), () => api.cluster.nodes({ cursor, observationId }), { refetchIntervalMs: observationId ? undefined : 15_000 });
  const node = query.data?.items.find((n) => n.resourceId === selected);
  // 指标分页过期：自动回到最新一份观测的第一页（原「读取最新快照」按钮，2026-09-23 裁定去掉）。
  const expired = query.error?.status === 410;
  useExpiredSnapshotReset(expired, () => { setCursor(0); setObservationId(undefined); setSelected(undefined); });
  return <Card title={t('cluster.tab.nodes')} stacked><p className={styles.caption}>{t('cluster.metrics.nodesReadOnly')}</p><QueryStatus isPending={query.isPending || expired} error={expired ? null : query.error} />
    <DataTable className={styles.table} columns={[t('cluster.metrics.node'), t('cluster.status'), 'Pod', 'CPU', t('cluster.metrics.memory'), t('cluster.metrics.disk'), t('cluster.metrics.network')]}>{query.data?.items.map((n) => <tr key={n.uid}><td><Button variant="ghost" size="small" onClick={() => setSelected(n.resourceId)}>{n.name}</Button><small>{n.roles.join(', ')} · {n.version}</small></td><td>{n.ready ? t('cluster.yes') : t('cluster.no')}{n.unschedulable ? <small>{t('cluster.metrics.cordoned')}</small> : null}</td><td>{n.podCount} / {n.allocatable.pods ?? '—'}</td><td><MetricValue metric={n.metrics.cpu} compact /><small>{t('cluster.metrics.requests')} {amount(n.demand.requests.cpu ?? '0', 'cores')} / {amount(n.allocatable.cpu, 'cores')}</small></td><td><MetricValue metric={n.metrics.memory} compact /><small>{t('cluster.metrics.requests')} {amount(n.demand.requests.memory ?? '0')} / {amount(n.allocatable.memory)}</small></td><td><MetricValue metric={n.metrics.fsUsed} compact /><small>{t('cluster.metrics.available')} {amount(n.metrics.fsAvailable?.value)}</small></td><td>↓ <MetricValue metric={n.metrics.networkRx} compact /><br />↑ <MetricValue metric={n.metrics.networkTx} compact /></td></tr>)}</DataTable>
    <div className={styles.controls}>{cursor ? <Button onClick={() => { setCursor(0); setObservationId(undefined); setSelected(undefined); }}>{t('cluster.firstPage')}</Button> : null}{query.data?.nextCursor !== undefined ? <Button onClick={() => { setCursor(query.data!.nextCursor!); setObservationId(query.data!.observationId); setSelected(undefined); }}>{t('cluster.nextPage')}</Button> : null}</div>
    {node ? <NodeDetails node={node} close={() => setSelected(undefined)} selectPod={selectPod} /> : null}
  </Card>;
}
function NodeDetails({ node, close, selectPod }: { node: ClusterNode; close: () => void; selectPod: (id: string) => void }) {
  const t = useT(), [device, setDevice] = useState(''), [network, setNetwork] = useState('');
  return <Card title={node.name} extra={<Button variant="ghost" onClick={close}>{t('cluster.close')}</Button>} stacked><p className={styles.code}>UID: {node.uid}</p><ResourceBudgetTable demand={node.demand} capacity={node.capacity} allocatable={node.allocatable} />
    <details><summary>{t('cluster.metrics.conditions')}</summary>{node.conditions.map((c) => <p key={c.type}>{c.type}: {c.status} · {c.reason}</p>)}{node.errors.map((error) => <p key={error}>{error}</p>)}</details>
    <div className={styles.split}>{(['fsUsed', 'fsAvailable', 'fsInodes', 'fsInodesUsed', 'imageFsUsed', 'containerFsUsed'] as const).map((metric) => <article key={metric}><strong>{t(`cluster.metric.${metric}`)}</strong><br /><MetricValue metric={node.metrics[metric]} /></article>)}</div><p className={styles.caption}>{t('cluster.metrics.filesystemHint')}</p>
    <DataTable className={styles.budgetTable} columns={[t('cluster.metrics.interface'), t('cluster.metric.networkRx'), t('cluster.metric.networkTx'), t('cluster.metric.networkRxErrors'), t('cluster.metric.networkTxErrors')]}>{Object.entries(node.interfaces).map(([name, metrics]) => <tr key={name}><td><Button variant="ghost" size="small" onClick={() => { setNetwork(name); setDevice(''); }}>{name}</Button></td>{(['networkRx', 'networkTx', 'networkRxErrors', 'networkTxErrors'] as const).map((m) => <td key={m}><MetricValue metric={metrics[m]} compact /></td>)}</tr>)}</DataTable>
    <DataTable className={styles.budgetTable} columns={[t('cluster.metrics.device'), t('cluster.metric.diskRead'), t('cluster.metric.diskWrite'), t('cluster.metric.diskReadOps'), t('cluster.metric.diskWriteOps')]}>{Object.entries(node.devices).map(([name, metrics]) => <tr key={name}><td><Button variant="ghost" size="small" onClick={() => { setDevice(name); setNetwork(''); }}>{name}</Button></td>{(['diskRead', 'diskWrite', 'diskReadOps', 'diskWriteOps'] as const).map((m) => <td key={m}><MetricValue metric={metrics[m]} compact /></td>)}</tr>)}</DataTable><p className={styles.caption}>{t('cluster.metrics.deviceHint')}</p>
    <details><summary>{t('cluster.metrics.managedPods', { count: node.managedPodIds.length })}</summary><div className={styles.controls}>{node.managedPodIds.map((id) => <Button key={id} variant="ghost" size="small" onClick={() => selectPod(id)}>{node.managedPods?.find((p) => p.resourceId === id)?.name ?? id}</Button>)}</div></details>
    {device || network ? <p>{device || network} <Button size="small" onClick={() => { setDevice(''); setNetwork(''); }}>{t('cluster.metrics.nodeHistory')}</Button></p> : null}<ClusterHistory key={`${device}/${network}`} scope="node" resourceId={node.resourceId} device={device || undefined} networkInterface={network || undefined} />
  </Card>;
}
