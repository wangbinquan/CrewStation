import { useState } from 'react';
import type { ClusterAction, ClusterInspection, ClusterResource } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { Button } from '../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../shared/ui/ConfirmationPanel';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { OperationResult } from './ClusterOperations';
import styles from './Cluster.module.css';
export function ClusterActionPanel({ row, onOperation }: { row: ClusterResource; onOperation: (id: string) => void }) {
  const t = useT(), [action, setAction] = useState<ClusterAction>(), [replicas, setReplicas] = useState(String(row.desired ?? 1)), [inspection, setInspection] = useState<ClusterInspection>();
  const storageKey = `cluster-operation:${row.resourceId}`;
  const [pending, setPending] = useState(() => readPending(storageKey));
  const [operationId, setOperationId] = useState<string | undefined>(pending?.operationId), [idempotencyKey, setIdempotencyKey] = useState(() => pending?.key ?? crypto.randomUUID());
  const capability = row.availableActions.find((a) => a.action === action), n = Number(replicas);
  const invalid = action === 'scale' && (!/^\d+$/.test(replicas) || !Number.isInteger(n) || n < (capability?.minReplicas ?? 1) || n > (capability?.maxReplicas ?? 1));
  const inspect = useApiMutation(() => api.cluster.inspect(row.resourceId, { action: action!, ...(action === 'scale' ? { replicas: n } : {}) }), { onSuccess: (result) => setInspection(result) });
  const accepted = (id: string) => { setOperationId(id); sessionStorage.setItem(storageKey, JSON.stringify({ key: idempotencyKey, operationId: id })); onOperation(id); };
  const submit = useApiMutation(() => { sessionStorage.setItem(storageKey, JSON.stringify({ key: idempotencyKey })); setPending({ key: idempotencyKey }); return api.cluster.accept({ inspectionId: inspection!.inspectionId, idempotencyKey, params: inspection!.request }); }, { onSuccess: (result) => accepted(result.operationId) });
  const recovery = useApiQuery(queryKeys.cluster('recover', idempotencyKey), () => api.cluster.operations({ idempotencyKey: idempotencyKey }), { enabled: (!!submit.error || !!pending) && !operationId, refetchIntervalMs: 3000 });
  const recovered = recovery.data?.items[0], id = operationId ?? recovered?.operationId;
  const operation = useApiQuery(queryKeys.cluster('operation', id), () => api.cluster.operation(id!), { enabled: !!id, refetchIntervalMs: 2000, refetchOnWindowFocus: true });
  const open = (next: ClusterAction) => { setAction(next); setInspection(undefined); inspect.reset(); submit.reset(); setIdempotencyKey(crypto.randomUUID()); setPending(undefined); sessionStorage.removeItem(storageKey); };
  return <div className={styles.stack}>
    <div className={styles.actions}>{row.availableActions.map((c) => <div className={styles.action} key={c.action}><Button onClick={() => open(c.action)} disabled={!c.enabled || submit.isPending || !!id}>{t(`cluster.action.${c.action}`)}</Button>{!c.enabled ? <small className={styles.muted}>{c.reason}</small> : null}</div>)}</div>
    {action && !id ? <div className={styles.stack}><p>{t(`cluster.action.${action}`)} · <strong>{row.name}</strong></p>{action === 'scale' ? <label>{t('cluster.replicas')}<input className={styles.input} inputMode="numeric" value={replicas} onChange={(e) => { setReplicas(e.target.value); setInspection(undefined); }} aria-invalid={invalid} aria-describedby="cluster-replica-constraint" /><small id="cluster-replica-constraint" className={invalid ? styles.error : styles.muted}>{t('cluster.replicaConstraint', { min: capability?.minReplicas ?? 1, max: capability?.maxReplicas ?? 1 })}</small></label> : null}
      {!inspection ? <Button onClick={() => inspect.mutate(undefined)} disabled={invalid || inspect.isPending}>{inspect.isPending ? t('cluster.inspecting') : t('cluster.inspect')}</Button> : <ConfirmationPanel question={t('cluster.confirmAction', { action: t(`cluster.action.${action}`), name: row.name })} hint={t('cluster.expires', { time: new Date(inspection.expiresAt).toLocaleTimeString() })} confirmLabel={t('cluster.confirm')} cancelLabel={t('cluster.cancel')} busy={submit.isPending} confirmDisabled={!inspection.capability.enabled || !!submit.error} onConfirm={() => submit.mutate(undefined)} onCancel={() => { setAction(undefined); setInspection(undefined); }}>
        <ul>{inspection.capability.impactSummary.map((impact) => <li key={impact}>{impact}</li>)}</ul><InspectionImpact inspection={inspection} />{!inspection.capability.enabled ? <p className={styles.error}>{inspection.capability.reason}</p> : null}<p className={styles.muted}>UID: {inspection.target.uid}</p><p>{t('cluster.relatedCount', { count: inspection.related.length })}</p>{inspection.related.length ? <ul>{inspection.related.map((r) => <li key={r.uid}>{r.kind} · {r.name}</li>)}</ul> : null}
      </ConfirmationPanel>}
      <QueryStatus isPending={false} error={inspect.error ?? submit.error} />{submit.error ? <p>{t('cluster.recovering')} · HTTP {submit.error.status} · {idempotencyKey}</p> : null}
    </div> : null}
    {pending && !id && !action ? <p>{t('cluster.recovering')} · {idempotencyKey}</p> : null}
    {id ? <><QueryStatus isPending={operation.isPending} error={operation.error} />{operation.data ? <><OperationResult operation={operation.data} />{['succeeded', 'failed'].includes(operation.data.phase) ? <Button onClick={() => { sessionStorage.removeItem(storageKey); setPending(undefined); setOperationId(undefined); setAction(undefined); setIdempotencyKey(crypto.randomUUID()); submit.reset(); }}>{t('cluster.closeResult')}</Button> : null}</> : null}</> : null}
  </div>;
}
function InspectionImpact({ inspection }: { inspection: ClusterInspection }) {
  const t = useT(), workspace = inspection.domain?.workspace as { status?: string; uncommittedCount?: number; unpushed?: { count?: number }; reason?: string } | undefined;
  return workspace ? <p className={styles.warning}>{workspace.status === 'ready' ? t('cluster.workspace', { files: workspace.uncommittedCount ?? 0, commits: workspace.unpushed?.count ?? '?' }) : `${t('cluster.workspaceUnknown')} ${workspace.reason ?? ''}`}</p> : null;
}

function readPending(key: string): { key: string; operationId?: string } | undefined {
  try { const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null'); return value && typeof value === 'object' && 'key' in value && typeof value.key === 'string' ? value as { key: string; operationId?: string } : undefined; } catch { return undefined; }
}
