import { useState } from 'react';
import type { ClusterAction, ClusterInspection, ClusterResource } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Button } from '../../../shared/ui/Button';
import { ConfirmDialog } from '../../../shared/ui/dialog/ConfirmDialog';
import { Dialog, DialogClearButton } from '../../../shared/ui/dialog/Dialog';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { OperationResult } from './ClusterOperations';
import styles from './Cluster.module.css';
/**
 * 资源的管理动作（2026-09-23 作者裁定都在弹窗里）：重启、调整副本、恢复发布配置在弹窗里先检查影响、再确认；
 * 删除／结束不可撤销，点下去就弹窗并自动检查影响，输入 delete 才能确认。受理后弹窗关闭，操作进度与结果在页内显示。
 */
export function ClusterActionPanel({ row, onOperation }: { row: ClusterResource; onOperation: (id: string) => void }) {
  // 目标副本数是调整副本弹窗的草稿：关窗留着、再打开恢复，「清空」回到当前副本数。
  const initialReplicas = String(row.desired ?? 1);
  const t = useT(), [action, setAction] = useState<ClusterAction>(), [replicas, setReplicas] = useState(initialReplicas), [inspection, setInspection] = useState<ClusterInspection>();
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
    {action && !id && !deleting ? <Dialog size="medium" role={current ? 'alertdialog' : 'dialog'} title={t(`cluster.action.${action}`)} busy={submit.isPending} onClose={close}
      onSubmit={() => { if (!current && !invalid && !inspect.isPending) runInspect(action); }}
      footer={<ActionRow>
        {!current ? <Button type="submit" variant="primary" disabled={invalid || inspect.isPending}>{inspect.isPending ? t('cluster.inspecting') : t('cluster.inspect')}</Button>
          : <Button variant="primary" disabled={submit.isPending || !current.capability.enabled || !!submit.error} onClick={() => submit.mutate(undefined)}>{t('cluster.confirm')}</Button>}
        <Button variant="ghost" disabled={submit.isPending} onClick={close}>{t('cluster.cancel')}</Button>
        {action === 'scale' ? <DialogClearButton busy={submit.isPending} dirty={replicas !== initialReplicas} onClear={() => { setReplicas(initialReplicas); setInspection(undefined); }} /> : null}
      </ActionRow>}>
      <p>{current ? t('cluster.confirmAction', { action: t(`cluster.action.${action}`), name: row.name }) : <>{t(`cluster.action.${action}`)} · <strong>{row.name}</strong></>}</p>
      {action === 'scale' ? <label className={styles.stack}>{t('cluster.replicas')}<input className={styles.input} inputMode="numeric" value={replicas} disabled={submit.isPending} onChange={(e) => { setReplicas(e.target.value); setInspection(undefined); }} aria-invalid={invalid} aria-describedby="cluster-replica-constraint" /><small id="cluster-replica-constraint" className={invalid ? styles.error : styles.muted}>{t('cluster.replicaConstraint', { min: capability?.minReplicas ?? 1, max: capability?.maxReplicas ?? 1 })}</small></label> : null}
      {current ? <><p className={styles.muted}>{t('cluster.expires', { time: new Date(current.expiresAt).toLocaleTimeString() })}</p><InspectionDetails inspection={current} /></> : null}
      <QueryStatus isPending={false} error={inspect.error ?? submit.error} />{submit.error ? <p>{t('cluster.recovering')} · HTTP {submit.error.status} · {idempotencyKey}</p> : null}
    </Dialog> : null}
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
