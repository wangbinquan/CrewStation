import { useState } from 'react';
import type { ResourceRequest } from './model';
import { PENDING_STATES, REQUEST_LABEL } from './model';
import { ActionNote, ActionRow, Badge, Button, Card, ConfirmationDialog, DataTable, DefinitionList, Dialog, FormField, Stack } from './ui';
import type { Workspace } from './useWorkspace';
import { changeSummary } from './fields';

export function RequestList({ ws }: { ws: Workspace }) {
  const [filter, setFilter] = useState('all');
  const rows = ws.requests.filter((r) => filter === 'all' || (filter === 'active' ? PENDING_STATES.includes(r.state) : !PENDING_STATES.includes(r.state)));
  return <div className="request-list"><div className="view-heading"><div><strong>申请与变更记录</strong><p className="muted">申请、审批、直接管理共用一份项目记录。</p></div><select aria-label="筛选申请状态" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部记录</option><option value="active">进行中</option><option value="finished">已结束</option></select></div>
    <DataTable columns={['申请 / 变更', '当前 → 目标', '发起人', '状态', '操作']}><>{rows.map((r) => <tr key={r.id}><td><strong>{r.title}</strong><small>{r.id} · {r.createdAt} {r.direct ? '· 直接管理' : ''}</small></td><td>{r.before}<small>→ {r.after}</small></td><td>{r.requester}</td><td><RequestBadge request={r} /></td><td><Button variant="secondary" size="small" onClick={() => ws.setRequestId(r.id)}>{ws.role === 'admin' && r.state === 'pending' ? '审批' : '查看详情'}</Button></td></tr>)}</></DataTable>
    {!rows.length ? <div className="empty">此状态下暂无记录。</div> : null}
  </div>;
}
export function RequestBadge({ request }: { request: ResourceRequest }) {
  return <Badge tone={request.state === 'applied' ? 'success' : ['rejected', 'apply-failed'].includes(request.state) ? 'danger' : PENDING_STATES.includes(request.state) ? 'warning' : 'neutral'}>{REQUEST_LABEL[request.state]}</Badge>;
}
type Decision = 'approve' | 'reject' | 'cancel' | 'retry';
const actionLabels: Record<Decision, string> = { approve: '批准并执行', reject: '驳回申请', cancel: '撤回申请', retry: '重新核对并重试' };

function DecisionForm({ request, action, ws, close }: { request: ResourceRequest; action: Decision; ws: Workspace; close: () => void }) {
  const [error, setError] = useState<string>();
  const key = `decision:${request.id}:${action}`, initial = String(request.approvedQuantity ?? request.quantity ?? '');
  const draft = ws.drafts[key] ?? { reason: '', values: { quantity: initial } };
  const reason = draft.reason, quantity = String(draft.values.quantity ?? initial);
  const setReason = (value: string) => ws.setDrafts((all) => ({ ...all, [key]: { ...draft, reason: value } }));
  const setQuantity = (value: string) => ws.setDrafts((all) => ({ ...all, [key]: { ...draft, values: { quantity: value } } }));
  const clear = () => ws.setDrafts((all) => { const copy = { ...all }; delete copy[key]; return copy; });
  const entry = ws.entries.find((e) => e.id === request.target);
  const submit = () => {
    if (action === 'reject' && reason.trim().length < 5) { setError('请说明驳回原因，至少 5 个字。'); return; }
    const number = Number(quantity), changed = request.quantity !== undefined && action === 'approve' && number !== request.quantity;
    if (changed && (!Number.isFinite(number) || number <= 0 || (entry?.quota?.unit === '个' && !Number.isInteger(number)))) { setError('批准值需要是有效的正数；计数配额需为整数。'); return; }
    if (changed && entry?.id === 'objects' && number < (entry.quota?.used ?? 0)) { setError('批准容量不能低于已用与预留之和。'); return; }
    if (changed && reason.trim().length < 5) { setError('修改批准值时，请说明调整依据，至少 5 个字。'); return; }
    const base = request.changes ?? [{ key: 'limit', label: entry?.quota?.label ?? '配额', before: entry?.quota?.limit ?? 0, after: request.quantity ?? 0, unit: entry?.quota?.unit ?? '' }];
    const changes = base.map((c) => c.key === 'limit' ? { ...c, after: number } : c);
    if (changed && !changes.some((c) => c.key === 'limit')) changes.push({ key: 'limit', label: entry?.quota?.label ?? '配额', before: entry?.quota?.limit ?? 0, after: number, unit: entry?.quota?.unit ?? '' });
    ws.decide(request, action, reason, changed ? { approvedQuantity: number, approvedChanges: changes, approvedAfter: changeSummary(changes, 'after') } : undefined); clear(); close();
  };
  return <ConfirmationDialog title={`${actionLabels[action]} · ${request.id}`} question={`确认${actionLabels[action]}？`} confirmLabel={actionLabels[action]} onConfirm={submit} onCancel={close} danger={action === 'reject'} size="medium" onClear={clear} dirty={Boolean(reason || quantity !== initial)}>
    <Stack><DefinitionList items={[{ label: '资源', value: entry?.title }, { label: '当前 → 目标', value: `${request.before} → ${request.after}` }, { label: '申请理由', value: request.reason }]} />
      {action === 'approve' && request.quantity !== undefined ? <FormField label={`批准上限（${entry?.quota?.unit ?? ''}）`} hint="可调整批准值；原申请值保留在记录中。"><input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></FormField> : null}
      {action !== 'cancel' ? <FormField label={action === 'reject' ? '驳回原因（必填）' : '审批意见'}><textarea rows={3} placeholder="说明此次决定的依据" value={reason} onChange={(e) => { setReason(e.target.value); setError(undefined); }} /></FormField> : null}
      <div className="notice"><strong>{action === 'cancel' ? '撤回后可重新提交' : '核对生效范围'}</strong><p>{action === 'cancel' ? '当前有效配置不受影响；原申请保留在历史记录中。' : entry?.effect}</p></div>
      {error ? <ActionNote tone="error">{error}</ActionNote> : null}
    </Stack>
  </ConfirmationDialog>;
}
export function RequestDialog({ request, ws }: { request: ResourceRequest; ws: Workspace }) {
  const [decision, setDecision] = useState<Decision>();
  const active = PENDING_STATES.includes(request.state), admin = ws.role === 'admin';
  const buttons = admin && request.state === 'pending' ? <><Button variant="primary" onClick={() => setDecision('approve')}>批准申请</Button><Button variant="danger" onClick={() => setDecision('reject')}>驳回</Button></> : null;
  return <>
    <Dialog title={`${request.title} · ${request.id}`} size="medium" onClose={() => ws.setRequestId(undefined)} footer={<ActionRow>{buttons}
      {admin && ['apply-failed', 'needs-review'].includes(request.state) ? <Button variant="primary" onClick={() => setDecision('retry')}>重新核对并重试</Button> : null}
      {ws.role === 'owner' && ['pending', 'needs-review'].includes(request.state) ? <Button variant="secondary" onClick={() => setDecision('cancel')}>撤回申请</Button> : null}
      <Button variant="ghost" onClick={() => ws.setRequestId(undefined)}>关闭</Button>
    </ActionRow>}><Stack>
      <ActionRow><RequestBadge request={request} /><span className="muted">{request.requester} · {request.createdAt}{request.direct ? ' · 直接管理' : ''}</span></ActionRow>
      <div className="flow-steps"><span className="done">1 提交</span><span className={['pending', 'needs-review'].includes(request.state) ? 'current' : ['applying', 'applied', 'apply-failed'].includes(request.state) ? 'done' : ''}>2 {request.direct ? '管理确认' : request.state === 'rejected' ? '审批驳回' : request.state === 'cancelled' ? '已撤回' : '平台审批'}</span><span className={request.state === 'applying' ? 'current' : request.state === 'applied' ? 'done' : ''}>3 同步生效</span></div>
      <Card title="变更内容" compact><DefinitionList items={[{ label: '当前有效 / 变更前', value: request.before }, { label: '申请目标', value: request.after }, { label: '业务理由', value: request.reason }]} /></Card>
      {request.approvedAfter ? <div className="notice"><strong>实际批准目标</strong><p>{request.approvedAfter} · 原申请目标已保留。</p></div> : null}
      {request.decision ? <div className={`notice ${['rejected', 'apply-failed', 'needs-review'].includes(request.state) ? 'warning' : ''}`}><strong>处理结果</strong><p>{request.decision}</p></div> : null}
      {active ? <p className="muted">{request.state === 'applying' ? '正在等待所属能力确认；授权写入与实际就绪分开显示。' : '批准并生效之前，原资源与原配额继续有效。'}</p> : null}
      <small className="muted">示例审计记录 · 正式实现还将展示审批人、操作时间和资源版本。</small>
    </Stack></Dialog>
    {decision ? <DecisionForm request={request} action={decision} ws={ws} close={() => setDecision(undefined)} /> : null}
  </>;
}
