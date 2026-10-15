import { useState } from 'react';
import type { Capability, Change, Role } from './model';
import { CONTEXT_NAMES, changeName, openChange, statusName } from './model';
import { Badge, Button, Dialog, FormDialog, FormField } from '../prototype/ui';
import type { Topology } from '../../../../apps/console/src/shared/ui/topology/topologyModel';

interface ListProps { capabilities: Capability[]; changes: Change[]; role: Role; onOpen: (id: string) => void }
export function PermissionList({ capabilities, changes, role, onOpen }: ListProps) {
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all');
  const items = capabilities.filter((c) => `${c.name} ${c.type} ${c.scope}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || filter === 'pending' ? filter === 'all' || !!openChange(changes, c.id) : c.eligibility === filter && (filter !== 'requestable' || !openChange(changes, c.id))));
  return <div className="permission-list">
    <div className="list-tools"><input aria-label="搜索资源权限" placeholder="搜索资源、规格或权限…" value={search} onChange={(e) => setSearch(e.target.value)} /><select aria-label="资源状态" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部权限</option><option value="used">已使用</option><option value="available">已授权 · 未使用</option><option value="requestable">可申请</option><option value="pending">申请中 / 待生效</option></select></div>
    <div className="permission-heading"><span>资源与授权范围</span><span>规格 / 用量 / 配额</span><span>操作</span></div>
    {items.map((c) => { const pending = openChange(changes, c.id); return <div className="permission-row" key={c.id}>
      <div><strong>{c.name}</strong><div className="resource-tags"><Badge tone={c.eligibility === 'used' ? 'success' : c.eligibility === 'available' ? 'info' : 'neutral'}>{pending && c.eligibility === 'requestable' ? '未授权' : statusName[c.eligibility]}</Badge>{pending ? <Badge tone="warning">{changeName[pending.status]}</Badge> : null}<span>{c.source}</span></div><small>{c.scope}</small></div>
      <div className="permission-value"><strong>{c.limit !== undefined ? `${c.used === undefined ? '用量未观测' : `${c.used} 已用`} / ${c.limit} ${c.unit}` : c.value}</strong>{c.used !== undefined && c.limit !== undefined ? <progress max={c.limit} value={c.used} aria-label={`${c.name}已用比例`} /> : null}<small>{pending ? `申请目标：${pending.to}` : c.type}</small></div>
      <Button size="small" onClick={() => onOpen(c.id)}>{pending ? role === 'admin' && pending.status === 'pending' ? '审批' : '查看进度' : role !== 'developer' && c.adjustable ? role === 'admin' ? '调整配额' : '申请调额' : role !== 'developer' && c.eligibility === 'requestable' ? role === 'admin' ? '分配' : '申请' : '详情'}</Button>
    </div>; })}
    {!items.length ? <div className="empty">当前筛选下没有资源。</div> : null}
    {role === 'developer' ? <p className="muted">开发者可查看全部可见资源及申请进度；申请由项目负责人提交。</p> : null}
  </div>;
}

export function NodeDialog({ id, topology, original, members, onClose, ...list }: ListProps & { id: string; topology: Topology; original: Topology; members: string[]; onClose: () => void }) {
  const [tab, setTab] = useState('permissions'), node = topology.nodes.find((n) => n.id === id);
  const related = topology.edges.filter((e) => e.from === id || e.to === id);
  return <Dialog title={`${CONTEXT_NAMES[id] ?? node?.title ?? id} · 资源与权限`} size="large" onClose={onClose}>
    <div className="object-summary"><span className="object-icon">◇</span><div><strong>{node?.title}</strong><p>{node?.subtitle} · {node?.statusText}</p></div><Badge tone="success">部署架构中的对象</Badge></div>
    <div className="dialog-tabs" role="tablist" aria-label="对象详情">
      {[['permissions', '资源与权限'], ['instances', `运行对象 · ${members.length}`], ['relations', `关系 · ${related.length}`]].map(([key, name]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key!)}>{name}</button>)}
    </div>
    {tab === 'permissions' ? <PermissionList {...list} capabilities={list.capabilities.filter((c) => c.contexts.includes(id))} /> : null}
    {tab === 'instances' ? <div className="simple-list">{members.length ? members.map((member) => { const instance = original.nodes.find((n) => n.id === member); return <div key={member}><div><strong>{instance?.title ?? member}</strong><p>{instance?.subtitle}</p><small>{instance?.meta?.join(' · ')}</small></div><Badge tone="success">{instance?.statusText ?? '未知'}</Badge></div>; }) : <p className="muted">此对象来自已配置的平台依赖，未将权限目录项视作运行实例。</p>}<p className="muted">规格、镜像授权的变化只影响后续选择；既有实例的版本和副本在发布流程中变更。</p></div> : null}
    {tab === 'relations' ? <div className="simple-list">{related.map((e) => <div key={`${e.from}:${e.to}:${e.kind}`}><strong>{CONTEXT_NAMES[e.from]} → {CONTEXT_NAMES[e.to]}</strong><span>{e.label} · {e.evidence === 'observed' ? '运行事实' : '配置声明'}</span></div>)}</div> : null}
  </Dialog>;
}

export interface Draft { value: string; reason: string }
export function ActionDialog({ item, change, role, draft, setDraft, onClose, onSave, onReject }: { item: Capability; change?: Change; role: Role; draft: Draft; setDraft: (next: Draft) => void; onClose: () => void; onSave: () => void; onReject: () => void }) {
  const review = role === 'admin' && change?.status === 'pending';
  const editable = review || role !== 'developer' && !change && (item.adjustable || item.eligibility === 'requestable');
  const title = review ? `审批 · ${item.name}` : editable ? `${role === 'admin' ? item.adjustable ? '直接调整' : '直接分配' : item.adjustable ? '申请调整' : '申请使用'} · ${item.name}` : `${item.name} · ${change ? '申请进度' : '资源详情'}`;
  const valid = draft.reason.trim().length >= 4 && (!item.adjustable || Number.isFinite(Number(draft.value)) && Number(draft.value) > 0 && Number(draft.value) !== item.limit && (!item.used || Number(draft.value) >= item.used));
  const content = <div className="form-content">
    <div className="scope-note"><span>授权 / 配额范围</span><strong>{item.scope}</strong><small>关联对象：{item.contexts.map((id) => CONTEXT_NAMES[id] ?? id).join('、')}</small></div>
    {change ? <div className="change-status"><Badge tone={change.status === 'pending' ? 'warning' : 'info'}>{changeName[change.status]}</Badge><strong>{change.id}</strong><span>{change.source === 'owner' ? '项目负责人提交' : '管理员直接调整'}</span><p>{change.reason}</p></div> : null}
    <div className="change-values"><div><span>当前生效</span><strong>{item.eligibility === 'requestable' ? '未授权' : item.value}</strong></div><b>→</b><div><span>{review ? '申请目标' : '目标值'}</span><strong>{change?.to ?? (item.adjustable ? `${draft.value || '待填写'} ${item.unit}` : item.value)}</strong></div></div>
    {editable ? <><div className="form-fields">{item.adjustable ? <FormField label={`${review ? '批准' : '目标'}配额（${item.unit}）`} hint={item.used !== undefined ? `当前已用 ${item.used} ${item.unit}。演示表单不允许低于该值。` : '提交时重新校验最新配额及修订。'}><input type="number" min={item.used ?? 1} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} /></FormField> : <FormField label="申请 / 分配范围"><input value={`本项目 · ${item.value}`} readOnly /></FormField>}<FormField label={role === 'admin' ? '管理说明' : '申请理由'} hint="至少 4 个字，记录本次资源变更的用途。"><textarea rows={3} value={draft.reason} placeholder="说明预期用途、容量需求与影响…" onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></FormField></div><p className="approval-path">{role === 'admin' ? '管理员处理 → 等待应用回执 → 生效' : '项目负责人申请 → 平台管理员审批 → 等待生效'}</p></> : null}
    <div className="effect"><strong>生效与影响</strong><p>{item.effect}</p></div>
    <p className="prototype-note">交互原型：提交仅更新本页演示状态。</p>
  </div>;
  if (!editable) return <Dialog title={title} onClose={onClose}>{content}</Dialog>;
  return <FormDialog title={title} submitLabel={review ? '批准申请' : role === 'admin' ? '确认调整' : '提交申请'} onClose={onClose} onSubmit={onSave} submitDisabled={!valid} onClear={() => setDraft({ value: String(item.limit ?? ''), reason: '' })} dirty={!!draft.reason || draft.value !== String(item.limit ?? '')} actions={review ? <Button variant="danger" disabled={draft.reason.trim().length < 4} onClick={onReject}>驳回申请</Button> : undefined}>{content}</FormDialog>;
}

export function ChangesDialog({ changes, capabilities, onOpen, onClose }: Pick<ListProps, 'changes' | 'capabilities' | 'onOpen'> & { onClose: () => void }) {
  return <Dialog title="资源变更记录" size="large" onClose={onClose}><div className="simple-list">{changes.map((c) => <div key={c.id}><div><strong>{capabilities.find((item) => item.id === c.target)?.name}</strong><p>{c.id} · {c.from} → {c.to}</p><small>{c.reason}</small></div><Badge tone={c.status === 'pending' ? 'warning' : 'info'}>{changeName[c.status]}</Badge><Button size="small" onClick={() => onOpen(c.target)}>查看</Button></div>)}</div></Dialog>;
}
