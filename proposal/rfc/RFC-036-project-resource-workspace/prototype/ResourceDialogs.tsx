import { useState } from 'react';
import { ActionNote, ActionRow, Badge, Button, Card, DefinitionList, Dialog, FormDialog, FormField, Stack } from './ui';
import { ACCESS_LABEL, CATEGORY_LABEL, edges, pendingFor, REQUEST_LABEL } from './model';
import type { Draft, Entry } from './model';
import { accessOf } from './topology';
import { changesFor, draftFor, fieldsFor, metricsFor, validationFor } from './fields';
import type { Workspace } from './useWorkspace';

export function DetailDialog({ entry, ws }: { entry: Entry; ws: Workspace }) {
  const pending = pendingFor(ws.requests, entry.id), access = accessOf(entry, ws.requests);
  const relations = edges.filter((e) => e.from === entry.id || e.to === entry.id);
  const canChange = ws.role !== 'developer' && (entry.access === 'requestable' || entry.adjustable);
  const action = entry.access === 'requestable' ? ws.role === 'admin' ? '分配给项目' : '申请此资源' : ws.role === 'admin' ? '调整资源配置' : '申请修改配额 / 分配';
  return <Dialog title={entry.title} size="large" onClose={() => ws.setSelected(undefined)} footer={<ActionRow>
    {canChange ? <Button variant="primary" disabled={Boolean(pending)} onClick={() => ws.setChanging(entry.id)}>{pending ? '已有进行中的申请' : action}</Button> : null}
    {pending ? <Button variant="secondary" onClick={() => ws.setRequestId(pending.id)}>{ws.role === 'admin' ? '处理申请' : '查看申请'} · {pending.id}</Button> : null}
    <Button variant="ghost" onClick={() => ws.setSelected(undefined)}>关闭</Button>
  </ActionRow>}>
    <Stack>
      <ActionRow><Badge tone={access === 'owned' ? 'success' : access === 'pending' ? 'warning' : 'info'}>{ACCESS_LABEL[access]}</Badge><Badge>{entry.stateText}</Badge><span className="muted">{CATEGORY_LABEL[entry.category]} · {entry.source}</span></ActionRow>
      <p>{entry.summary}</p>
      <div className="detail-metrics">{metricsFor(entry, ws.scenario === 'partial').map(([name, value]) => <div key={name}><span>{name}</span><strong>{value}</strong></div>)}</div>
      {pending ? <div className="notice warning"><strong>{REQUEST_LABEL[pending.state]} · {pending.before} → {pending.approvedAfter ?? pending.after}</strong><p>当前有效值保持不变，所属能力确认生效后更新。</p></div> : null}
      <Card title="归属与生效范围"><DefinitionList layout="grid" items={[{ label: '归属', value: entry.owner }, ...entry.facts.map(([label, value]) => ({ label, value }))]} /><p className="effect">{entry.effect}</p></Card>
      {fieldsFor(entry).length ? <Card title="当前有效配置" compact><DefinitionList layout="grid" items={fieldsFor(entry).map((f) => ({ label: f.label, value: `${f.value} ${f.unit}` }))} /></Card> : null}
      <Card title="关联关系" compact><div className="relations">{relations.map((edge) => {
        const other = ws.entries.find((e) => e.id === (edge.from === entry.id ? edge.to : edge.from));
        return other ? <button key={`${edge.from}-${edge.to}`} className="relation" onClick={() => ws.setSelected(other.id)}><span>{edge.evidence === 'static' ? '┄' : '→'} {edge.from === entry.id ? entry.title : other.title} <span className="relation-label">{edge.label}</span> {edge.to === entry.id ? entry.title : other.title}</span><span>查看 ↗</span></button> : null;
      })}</div></Card>
      {ws.role === 'developer' ? <ActionNote tone="neutral">资源变更由项目负责人张明提交；开发者可以查看资源、配额和申请进度。</ActionNote> : null}
      <small className="muted">策略版本 r18 · 运行快照 10:45:00 · 本原型为示例数据</small>
    </Stack>
  </Dialog>;
}

function ChangeFields({ entry, draft, update }: { entry: Entry; draft: Draft; update: (draft: Draft) => void }) {
  return <div className="form-grid">{fieldsFor(entry).map((field) => <FormField key={field.key} label={`${field.label}${field.unit ? `（${field.unit}）` : ''}`} hint={`当前 ${field.value}${field.unit}${field.used !== undefined ? ` · 占用 ${field.used}${field.unit}` : ''}`}>
    {field.options ? <select value={draft.values[field.key]} onChange={(event) => update({ ...draft, values: { ...draft.values, [field.key]: event.target.value } })}>{field.options.map((value) => <option key={value}>{value}</option>)}</select>
      : <input type="number" min="0" step={field.unit === '个' ? '1' : 'any'} value={draft.values[field.key]} onChange={(event) => update({ ...draft, values: { ...draft.values, [field.key]: event.target.value === '' ? '' : Number(event.target.value) } })} />}
  </FormField>)}</div>;
}
export function ChangeDialog({ entry, ws }: { entry: Entry; ws: Workspace }) {
  const [error, setError] = useState<string>();
  const draft = ws.drafts[entry.id] ?? draftFor(entry), grant = entry.access === 'requestable';
  const update = (value: Draft) => { ws.setDrafts((all) => ({ ...all, [entry.id]: value })); setError(undefined); };
  const changes = changesFor(entry, draft), admin = ws.role === 'admin';
  const belowUsage = fieldsFor(entry).some((field) => field.used !== undefined && typeof draft.values[field.key] === 'number' && Number(draft.values[field.key]) < field.used);
  const title = grant ? admin ? '分配项目资源' : '申请项目资源' : admin ? '调整配额与分配' : '申请调整配额与分配';
  const submit = () => {
    const validation = validationFor(entry, draft, grant);
    if (validation) { setError(validation); return; }
    ws.submit(entry, draft);
  };
  return <FormDialog title={`${title} · ${entry.title}`} size="medium" onClose={() => ws.setChanging(undefined)} onSubmit={submit} submitLabel={admin ? '确认变更并记录' : '提交给平台管理员'} error={error} cancelLabel="取消，保留草稿" onClear={() => update(draftFor(entry))} dirty={Boolean(draft.reason || changes.length)}>
    <Stack>
      <div className="notice"><strong>订单协作助手 · {entry.owner}</strong><p>{grant ? entry.summary : '填写目标值；未修改的项目保持当前配置。'}</p></div>
      {grant ? <DefinitionList items={entry.metrics.map(([label, value]) => ({ label, value }))} /> : <ChangeFields entry={entry} draft={draft} update={update} />}
      {entry.id === 'prod-access' ? <div className="notice warning">本次授权：当前开发会话 DEV-2026-0930，只读，有效 60 分钟。会话内进程均可能使用连接；到期后自动撤销。</div> : null}
      {changes.length ? <div className="change-preview"><strong>本次变更</strong>{changes.map((c) => <div key={c.key}><span>{c.label}</span><span>{c.before} → <b>{c.after} {c.unit}</b></span></div>)}</div> : null}
      {belowUsage && entry.id !== 'objects' && entry.id !== 'rate-limit' ? <div className="notice warning">目标值低于当前占用。生效后将限制新增，现有执行不会被自动停止。</div> : null}
      <FormField label={admin ? '变更理由（必填）' : '用途与申请理由（必填）'} hint="说明业务用途、预计用量或调整原因，便于后续追溯。"><textarea rows={3} maxLength={1000} placeholder="例如：月末并行核对增加，预计需要……" value={draft.reason} onChange={(e) => update({ ...draft, reason: e.target.value })} /></FormField>
      <div className="notice"><strong>生效与影响</strong><p>{entry.effect}</p><p>{admin ? '管理员直接变更，无需再提交审批；将记录操作者、前后差异和原因。' : '申请人：张明（项目负责人） → 审批人：平台管理员。批准后继续追踪生效状态。'}</p></div>
      {ws.scenario === 'partial' ? <ActionNote tone="neutral">当前用量采集不完整；正式实现需先重新核对用量，原型中不代表真实容量校验。</ActionNote> : null}
    </Stack>
  </FormDialog>;
}
export function CatalogDialog({ ws }: { ws: Workspace }) {
  const [query, setQuery] = useState('');
  const quota = ws.catalog === 'quota';
  const eligible = ws.entries.filter((entry) => (quota ? entry.adjustable && entry.access === 'owned' : entry.access === 'requestable') && entry.title.includes(query));
  return <Dialog title={quota ? '选择要调整的配额与分配' : ws.role === 'admin' ? '给项目分配资源' : '申请新的项目资源'} size="large" onClose={() => ws.setCatalog(undefined)}>
    <Stack>
      <p className="muted">{quota ? '选择项目已有配置，在本页提交变更。' : '以下为平台明确开放给本项目的资源；默认可用与已授权项已在资源拓扑中展示。'}</p>
      <input type="search" placeholder="搜索资源名称" aria-label="搜索申请目录" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="catalog-grid">{eligible.map((entry) => {
        const pending = pendingFor(ws.requests, entry.id);
        return <article className="catalog-item" key={entry.id}><div className="catalog-heading"><strong>{entry.title}</strong><Badge tone={pending ? 'warning' : 'info'}>{pending ? REQUEST_LABEL[pending.state] : quota ? '已有配置' : '可以申请'}</Badge></div><p>{entry.summary}</p><div className="catalog-spec">{metricsFor(entry).slice(0, 2).map(([k, v]) => <span key={k}>{k} · {v}</span>)}</div><Button variant="secondary" onClick={() => pending ? ws.setRequestId(pending.id) : ws.setChanging(entry.id)}>{pending ? '查看申请' : quota ? '调整此配置' : ws.role === 'admin' ? '分配给项目' : '申请此资源'}</Button></article>;
      })}</div>
      {!eligible.length ? <div className="empty">没有符合条件的资源，可尝试其他名称。</div> : null}
    </Stack>
  </Dialog>;
}
