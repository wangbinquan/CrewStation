import type { ClusterOperation } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { Badge } from '../../../shared/ui/Badge';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import styles from './Cluster.module.css';
export function OperationResult({ operation }: { operation: ClusterOperation }) {
  const t = useT(), reconcile = useApiMutation(() => api.cluster.reconcile(operation.operationId), { invalidate: [['cluster']] });
  return <article className={styles.operation} aria-label={operation.operationId}><p><Badge tone={operation.phase === 'succeeded' ? 'success' : operation.phase === 'failed' || operation.phase === 'needs-attention' ? 'danger' : 'info'}>{t(`cluster.phase.${operation.phase}`)}</Badge> {t(`cluster.action.${operation.action}`)} · {operation.target.name}</p><p>{operation.reason}</p><dl className={styles.facts}><dt>{t('cluster.operationId')}</dt><dd>{operation.operationId}</dd><dt>HTTP · traceId</dt><dd>{operation.httpStatus} · {operation.traceId}</dd><dt>{t('cluster.duration')}</dt><dd>{(operation.durationMs / 1000).toFixed(1)} s</dd>{operation.domainOperationId ? <><dt>{t('cluster.domainOperation')}</dt><dd>{operation.domainOperationId}</dd></> : null}<dt>{t('cluster.updated')}</dt><dd>{new Date(operation.updatedAt).toLocaleString()}</dd></dl>{operation.phase === 'needs-attention' ? <Button disabled={reconcile.isPending} onClick={() => reconcile.mutate(undefined)}>{t('cluster.reconcile')}</Button> : null}<QueryStatus isPending={false} error={reconcile.error} /></article>;
}
export function ClusterOperations({ projectId, operationId }: { projectId?: string; operationId?: string }) {
  const t = useT(), query = useApiQuery(queryKeys.cluster('operations', projectId), () => api.cluster.operations({ projectId }), { refetchIntervalMs: 3000, refetchOnWindowFocus: true });
  const selected = useApiQuery(queryKeys.cluster('operation', operationId), () => api.cluster.operation(operationId!), { enabled: !!operationId, refetchIntervalMs: 3000 });
  return <Card title={t('cluster.tab.operations')} stacked><QueryStatus isPending={query.isPending} error={query.error} isEmpty={query.data?.items.length === 0} emptyTitle={t('cluster.noOperations')} />{operationId ? <QueryStatus isPending={selected.isPending} error={selected.error} /> : null}{selected.data ? <OperationResult operation={selected.data} /> : null}{query.data?.items.filter((o) => o.operationId !== operationId).map((o) => <OperationResult key={o.operationId} operation={o} />)}</Card>;
}
