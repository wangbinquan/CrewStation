import { useState } from 'react';
import type { ClusterAction, ClusterInspection, ClusterResource } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { Button } from '../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../shared/ui/ConfirmationPanel';
import { ConfirmDialog } from '../../../shared/ui/dialog/ConfirmDialog';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { OperationResult } from './ClusterOperations';
import styles from './Cluster.module.css';
/**
 * 资源的管理动作：重启与调整副本先检查影响、再在页内确认；删除／结束不可撤销，点下去就弹窗并自动检查影响，
 * 输入 delete 才能确认（2026-09-23 作者裁定）。受理后弹窗关闭，操作进度与结果在页内显示。
 */
export function ClusterActionPanel({ row, onOperation }: { row: ClusterResource; onOperation: (id: string) => void }) {
  const t = useT(), [action, setAction] = useState<ClusterAction>(), [replicas, setReplicas] = useState(String(row.desired ?? 1)), [inspection, setInspection] = useState<ClusterInspection>();
  const storageKey = `cluster-operation:${row.resourceId}`;
  const [pending, setPending] = useState(() => readPending(storageKey));
  const [operationId, setOperationId] = useState<string | undefined>(pending?.operationId), [idempotencyKey, setIdempotencyKey] = useState(() => pending?.key ?? crypto.randomUUID());
  const capability = row.availableActions.find((a) => a.action === action), n = Number(replicas);
  const invalid = action === 'scale' && (!/^\d+$/.test(replicas) || !Number.isInteger(n) || n < (capability?.minReplicas ?? 1) || n > (capability?.maxReplicas ?? 1));
  const inspect = useApiMutation((next: ClusterAction) => api.cluster.inspect(row.resourceId, { action: next, ...(next === 'scale' ? { replicas: n } : {}) }));
  // 检查结果只认最近一次、且仍是当前动作的那次：取消或换了动作之后，路上的旧结果不能挂到新动作上确认。
  const runInspect = (next: ClusterAction) => inspect.mutate(next, { onSuccess: (result) => setInspection(result) });
  const current = inspection?.request.action === action ? inspection : undefined, deleting = action === 'delete';
  const accepted = (id: string) => { setOperationId(id); sessionStorage.setItem(storageKey, JSON.stringify({ key: idempotencyKey, operationId: id })); onOperation(id); };
  const submit = useApiMutation(() => { sessionStorage.setItem(storageKey, JSON.stringify({ key: idempotencyKey })); setPending({ key: idempotencyKey }); return api.cluster.accept({ inspectionId: current!.inspectionId, idempotencyKey, params: current!.request }); }, { onSuccess: (result) => accepted(result.operationId) });
  const recovery = useApiQuery(queryKeys.cluster('recover', idempotencyKey), () => api.cluster.operations({ idempotencyKey: idempotencyKey }), { enabled: (!!submit.error || !!pending) && !operationId, refetchIntervalMs: 3000 });
  const recovered = recovery.data?.items[0], id = operationId ?? recovered?.operationId;
  const operation = useApiQuery(queryKeys.cluster('operation', id), () => api.cluster.operation(id!), { enabled: !!id, refetchIntervalMs: 2000, refetchOnWindowFocus: true });
  const open = (next: ClusterAction) => { setAction(next); setInspection(undefined); inspect.reset(); submit.reset(); setIdempotencyKey(crypto.randomUUID()); setPending(undefined); sessionStorage.removeItem(storageKey); if (next === 'delete') runInspect(next); };
  const close = () => { setAction(undefined); setInspection(undefined); inspect.reset(); };
  return <div className={styles.stack}>
    <div className={styles.actions}>{row.availableActions.map((c) => <div className={styles.action} key={c.action}><Button onClick={() => open(c.action)} disabled={!c.enabled || submit.isPending || !!id}>{t(`cluster.action.${c.action}`)}</Button>{!c.enabled ? <small className={styles.muted}>{c.reason}</small> : null}</div>)}</div>
    {action && !id && !deleting ? <div className={styles.stack}><p>{t(`cluster.action.${action}`)} · <strong>{row.name}</strong></p>{action === 'scale' ? <label>{t('cluster.replicas')}<input className={styles.input} inputMode="numeric" value={replicas} onChange={(e) => { setReplicas(e.target.value); setInspection(undefined); }} aria-invalid={invalid} aria-describedby="cluster-replica-constraint" /><small id="cluster-replica-constraint" className={invalid ? styles.error : styles.muted}>{t('cluster.replicaConstraint', { min: capability?.minReplicas ?? 1, max: capability?.maxReplicas ?? 1 })}</small></label> : null}
      {!current ? <Button onClick={() => runInspect(action)} disabled={invalid || inspect.isPending}>{inspect.isPending ? t('cluster.inspecting') : t('cluster.inspect')}</Button> : <ConfirmationPanel question={t('cluster.confirmAction', { action: t(`cluster.action.${action}`), name: row.name })} hint={t('cluster.expires', { time: new Date(current.expiresAt).toLocaleTimeString() })} confirmLabel={t('cluster.confirm')} cancelLabel={t('cluster.cancel')} busy={submit.isPending} confirmDisabled={!current.capability.enabled || !!submit.error} onConfirm={() => submit.mutate(undefined)} onCancel={close}>
        <InspectionDetails inspection={current} />
      </ConfirmationPanel>}
      <QueryStatus isPending={false} error={inspect.error ?? submit.error} />{submit.error ? <p>{t('cluster.recovering')} · HTTP {submit.error.status} · {idempotencyKey}</p> : null}
    </div> : null}
    {deleting && !id ? <ConfirmDialog title={t('cluster.action.delete')} question={t('cluster.confirmAction', { action: t('cluster.action.delete'), name: row.name })} confirmWord="delete" confirmLabel={t('cluster.confirm')} cancelLabel={t('cluster.cancel')}
      busy={submit.isPending} confirmDisabled={!current?.capability.enabled || !!submit.error} onConfirm={() => submit.mutate(undefined)} onCancel={close}>
      {current ? <><p className={styles.muted}>{t('cluster.expires', { time: new Date(current.expiresAt).toLocaleTimeString() })}</p><InspectionDetails inspection={current} /></> : inspect.isPending ? <p>{t('cluster.inspecting')}</p> : null}
      {inspect.error ? <Button onClick={() => runInspect('delete')}>{t('cluster.inspect')}</Button> : null}
      <QueryStatus isPending={false} error={inspect.error ?? submit.error} />{submit.error ? <p>{t('cluster.recovering')} · HTTP {submit.error.status} · {idempotencyKey}</p> : null}
    </ConfirmDialog> : null}
    {pending && !id && !action ? <p>{t('cluster.recovering')} · {idempotencyKey}</p> : null}
    {id ? <><QueryStatus isPending={operation.isPending} error={operation.error} />{operation.data ? <><OperationResult operation={operation.data} />{['succeeded', 'failed'].includes(operation.data.phase) ? <Button onClick={() => { sessionStorage.removeItem(storageKey); setPending(undefined); setOperationId(undefined); setAction(undefined); setIdempotencyKey(crypto.randomUUID()); submit.reset(); }}>{t('cluster.closeResult')}</Button> : null}</> : null}</> : null}
  </div>;
}
function InspectionDetails({ inspection }: { inspection: ClusterInspection }) {
  const t = useT();
  return <><ul>{inspection.capability.impactSummary.map((impact) => <li key={impact}>{impact}</li>)}</ul><InspectionImpact inspection={inspection} />{!inspection.capability.enabled ? <p className={styles.error}>{inspection.capability.reason}</p> : null}<p className={styles.muted}>UID: {inspection.target.uid}</p><p>{t('cluster.relatedCount', { count: inspection.related.length })}</p>{inspection.related.length ? <ul>{inspection.related.map((r) => <li key={r.uid}>{r.kind} · {r.name}</li>)}</ul> : null}</>;
}
function InspectionImpact({ inspection }: { inspection: ClusterInspection }) {
  const t = useT(), workspace = inspection.domain?.workspace as { status?: string; uncommittedCount?: number; unpushed?: { count?: number }; reason?: string } | undefined;
  return workspace ? <p className={styles.warning}>{workspace.status === 'ready' ? t('cluster.workspace', { files: workspace.uncommittedCount ?? 0, commits: workspace.unpushed?.count ?? '?' }) : `${t('cluster.workspaceUnknown')} ${workspace.reason ?? ''}`}</p> : null;
}

function readPending(key: string): { key: string; operationId?: string } | undefined {
  try { const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null'); return value && typeof value === 'object' && 'key' in value && typeof value.key === 'string' ? value as { key: string; operationId?: string } : undefined; } catch { return undefined; }
}
