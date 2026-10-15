import { useMemo, useState } from 'react';
import { Button, Badge, Dialog, TopologyDiagram, FULL_METRICS } from '../prototype/ui';
import { TopologyList } from '../../../../apps/console/src/shared/ui/topology/TopologyList';
import { useNarrow } from '../../../../apps/console/src/shared/ui/topology/TopologyWorkspace';
import { useT } from '../../../../apps/console/src/shared/lib/useT';
import { architecture } from './architecture';
import { INITIAL_CAPABILITIES, INITIAL_CHANGES } from './capabilities';
import { PERSPECTIVES, CONTEXT_NAMES, openChange } from './model';
import type { Capability, Change, Perspective, Role } from './model';
import { ActionDialog, ChangesDialog, NodeDialog, PermissionList } from './ResourceDialogs';
import type { Draft } from './ResourceDialogs';

const metrics = { ...FULL_METRICS, nodeW: 206, nodeH: 90, laneGap: 54, rowGap: 46, bandTitle: 12, laneHeader: 26, bandPad: 14 };
export function App() {
  const t = useT(), narrow = useNarrow(800);
  const [role, setRole] = useState<Role>('owner'), [view, setView] = useState<Perspective>('services');
  const [capabilities, setCapabilities] = useState<Capability[]>(INITIAL_CAPABILITIES), [changes, setChanges] = useState<Change[]>(INITIAL_CHANGES);
  const [dialog, setDialog] = useState<string>(), [node, setNode] = useState<string>(), [target, setTarget] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}), [notice, setNotice] = useState('');
  const [theme, setTheme] = useState('light');
  const graph = useMemo(() => architecture(view, t, capabilities, changes), [view, t, capabilities, changes]);
  const pending = changes.filter((c) => c.status === 'pending' || c.status === 'applying');
  const item = capabilities.find((c) => c.id === target), change = target ? openChange(changes, target) : undefined;
  const draft = item ? drafts[item.id] ?? { value: String(change ? Number.parseFloat(change.to) || item.limit || '' : item.limit ?? ''), reason: role === 'admin' && change ? '同意本次资源用途，按申请范围处理。' : '' } : { value: '', reason: '' };
  const listProps = { capabilities, changes, role, onOpen: setTarget };
  const save = (reject = false) => {
    if (!item || role === 'developer') return;
    const next: Change = { id: change?.id ?? `REQ-${1044 + changes.length}`, target: item.id, from: item.eligibility === 'requestable' ? '未授权' : item.value, to: item.adjustable ? `${draft.value} ${item.unit}` : item.value, reason: draft.reason, status: reject ? 'rejected' : role === 'admin' ? 'applying' : 'pending', source: change?.source ?? (role === 'admin' ? 'admin' : 'owner') };
    setChanges((previous) => change ? previous.map((c) => c.id === change.id ? next : c) : [next, ...previous]); setTarget(undefined);
    setDrafts((previous) => { const updated = { ...previous }; delete updated[item.id]; return updated; });
    setNotice(reject ? '申请已驳回（演示）' : role === 'admin' ? '已提交管理员决定，等待应用回执（演示）' : '申请已提交，等待平台管理员审批（演示）');
  };
  const applyReceipts = () => {
    setCapabilities((previous) => previous.map((c) => { const applying = changes.find((request) => request.target === c.id && request.status === 'applying'); if (!applying) return c; return c.adjustable ? { ...c, limit: Number.parseFloat(applying.to), value: applying.to } : { ...c, eligibility: 'available', source: '项目分配' }; }));
    setChanges((previous) => previous.map((c) => c.status === 'applying' ? { ...c, status: 'applied' } : c));
    setNotice('已收到演示生效回执；新增授权进入“已授权 · 未使用”，部署结构保持原样。');
  };
  const diagram = <TopologyDiagram key={view} topology={graph.topology} metrics={metrics} label="部署架构与资源" onSelect={setNode} />;
  return <div className="prototype-shell">
    <header className="topbar"><div className="brand"><b>◈</b> CrewStation <span>项目工作台</span></div><div className="review-controls"><Badge tone="warning">交互原型 · 演示数据</Badge><select aria-label="预览角色" value={role} onChange={(e) => { setRole(e.target.value as Role); setTarget(undefined); }}><option value="owner">项目负责人</option><option value="developer">开发者 · 只读</option><option value="admin">平台管理员</option></select><Button size="small" onClick={() => { const next = theme === 'light' ? 'dark' : 'light'; setTheme(next); document.documentElement.dataset.demoTheme = next; }}>{theme === 'light' ? '深色' : '浅色'}</Button></div></header>
    <aside className="sidebar"><div className="project-name"><small>{role === 'admin' ? '平台管理 / 项目详情' : '项目管理'}</small><strong>知识协作助手</strong><span>knowledge · 数字人</span></div><nav aria-label="项目页面">{['项目概览', '开发', '发布与上线', '运行与诊断', '项目资源', '项目设置'].map((title) => <span key={title} className={title === '项目资源' ? 'active' : ''}>{title === '项目资源' ? '◇ ' : ''}{title}</span>)}</nav><div className="sidebar-tip">资源围绕部署组织<br />沿用运行与诊断的架构</div></aside>
    <main className="content"><div className="breadcrumb">{role === 'admin' ? '平台管理' : '项目管理'} <span>/</span> 知识协作助手 <span>/</span> 项目资源</div>
      <div className="page-heading"><div><h1>项目资源</h1><p>从部署架构出发，查看资源归属、使用情况与权限。</p></div><div className="actions"><Button variant="primary" onClick={() => setDialog('catalog')}>{role === 'admin' ? '管理资源目录' : '资源目录'}</Button><Button onClick={() => setDialog('changes')}>资源变更 <b>{pending.length}</b></Button></div></div>
      <div className="quota-strip"><button className="quota-identity" onClick={() => setDialog('namespace')}><small>项目隔离与额度边界</small><strong>⌗ cs-knowledge</strong><span>命名空间配额 ↗</span></button>{['namespace-cpu', 'namespace-memory', 'namespace-pods', 'namespace-pvcs'].map((id) => { const c = capabilities.find((value) => value.id === id)!; return <button className="quota-tile" key={id} onClick={() => setTarget(id)}><span>{c.name}</span><strong>{c.used}<small> / {c.limit} {c.unit}</small>{openChange(changes, id) ? <i>{openChange(changes, id)?.status === 'applying' ? '待生效' : '申请中'}</i> : null}</strong><progress value={c.used} max={c.limit} aria-label={c.name} /></button>; })}</div>
      <section className="architecture-panel"><div className="view-bar"><div role="tablist" aria-label="部署视角">{PERSPECTIVES.map((p) => <button role="tab" key={p.id} aria-selected={view === p.id} onClick={() => { setView(p.id); setNode(undefined); }}>{p.name}</button>)}</div><div className="actions"><Button size="small" onClick={() => setDialog('baseline')}>运行与诊断基线</Button><Button size="small" onClick={() => setDialog('fullscreen')}>展开画布</Button></div></div>
        <div className="graph-note"><span>{PERSPECTIVES.find((p) => p.id === view)?.note}</span><Badge tone="neutral">副本已聚合</Badge></div>
        <div className="diagram">{narrow ? <TopologyList topology={graph.topology} onSelect={setNode} /> : diagram}</div>
        <div className="graph-legend"><span><i className="line" /> 运行事实</span><span><i className="line configured" /> 配置声明</span><span>虚线边框：命名空间内的资源</span><strong>点击对象查看权限列表与配额</strong></div>
      </section>
      <div className="support-row"><button className="support-card" onClick={() => setDialog('project')}><span className="support-icon">☷</span><div><strong>项目公共能力</strong><p>仓库 · 配置 · 日志与指标 · 执行并发 {capabilities.find((c) => c.id === 'execution-quota')?.used}/{capabilities.find((c) => c.id === 'execution-quota')?.limit}</p></div><span>查看 ›</span></button><button className="support-card" onClick={() => setDialog('catalog')}><span className="support-icon">＋</span><div><strong>已授权未使用 / 可申请资源</strong><p>先获得使用权，再在发布或工作区中选择</p></div><span>查看 ›</span></button></div>
      <div className="page-foot"><span>{role === 'owner' ? '项目负责人提交申请，平台管理员审批。' : role === 'admin' ? '管理员可在本页分配资源、调整配额、处理申请。' : '开发者可查看，申请由项目负责人提交。'}</span>{changes.some((c) => c.status === 'applying') ? <Button size="small" onClick={applyReceipts}>模拟生效回执</Button> : <span>所有视角共用项目级额度</span>}</div>
      {notice ? <div role="status" className="notice">{notice}<Button variant="ghost" size="small" onClick={() => setNotice('')}>关闭</Button></div> : null}
    </main>
    {node ? <NodeDialog key={node} id={node} topology={graph.topology} original={graph.original} members={graph.groups.find((g) => g.id === node)?.members ?? []} onClose={() => setNode(undefined)} {...listProps} /> : null}
    {dialog === 'catalog' || dialog === 'namespace' || dialog === 'project' ? <Dialog title={dialog === 'catalog' ? '项目资源目录' : CONTEXT_NAMES[dialog]!} size="large" onClose={() => setDialog(undefined)}><p className="dialog-intro">{dialog === 'catalog' ? '查看全部已使用、已授权未使用与明确开放申请的资源。可申请项不会出现在运行拓扑中。' : dialog === 'namespace' ? '该额度覆盖命名空间内全部工作负载。CPU、内存以请求量统计，与实时使用率分开。' : '项目公共能力统一查看；环境配置、日志与仓库不额外占用拓扑节点。'}</p><PermissionList key={dialog} {...listProps} capabilities={dialog === 'catalog' ? capabilities : capabilities.filter((c) => c.contexts.includes(dialog))} /></Dialog> : null}
    {dialog === 'changes' ? <ChangesDialog changes={changes} capabilities={capabilities} onOpen={setTarget} onClose={() => setDialog(undefined)} /> : null}
    {dialog === 'fullscreen' || dialog === 'baseline' ? <Dialog title={dialog === 'baseline' ? '运行与诊断 · 同一演示数据的原始拓扑' : '部署架构与资源'} size="fullscreen" onClose={() => setDialog(undefined)}><p className="dialog-intro">{dialog === 'baseline' ? '原型直接复用此图的组装函数与绘图组件；资源视图保留原始身份、关系和证据，将副本折叠到部署对象。' : '同一部署对象上的权限与配额在统一弹窗中管理。'}</p><TopologyDiagram topology={dialog === 'baseline' ? graph.original : graph.topology} label="展开的拓扑" metrics={dialog === 'baseline' ? undefined : metrics} onSelect={dialog === 'baseline' ? undefined : setNode} /></Dialog> : null}
    {item ? <ActionDialog item={item} change={change} role={role} draft={draft} setDraft={(next) => setDrafts((previous) => ({ ...previous, [item.id]: next }))} onClose={() => setTarget(undefined)} onSave={() => save()} onReject={() => save(true)} /> : null}
  </div>;
}
