import { useState } from 'react';
import { ACCESS_LABEL, CATEGORY_LABEL, pendingFor } from './model';
import type { Entry } from './model';
import { accessOf, makeTopology, matches } from './topology';
import { metricsFor } from './fields';
import { Badge, Button, DataTable, Dialog } from './ui';
import { ResourceTopology } from './ResourceTopology';
import type { Workspace } from './useWorkspace';

export interface Filters { category: string; access: string; search: string }
export function ResourceFilters({ ws, filters, onChange }: { ws: Workspace; filters: Filters; onChange: (value: Filters) => void }) {
  const counts = { all: ws.entries.length, owned: ws.entries.filter((e) => e.access === 'owned').length,
    requestable: ws.entries.filter((e) => accessOf(e, ws.requests) === 'requestable').length, pending: ws.entries.filter((e) => pendingFor(ws.requests, e.id)).length };
  return <div className="resource-filters"><div className="filter-row"><div className="state-filters">{(['all', 'owned', 'requestable', 'pending'] as const).map((value) => <button key={value} className={`filter-chip ${filters.access === value ? 'active' : ''}`} aria-pressed={filters.access === value} onClick={() => onChange({ ...filters, access: value })}><i className={`state-dot ${value}`} />{value === 'all' ? '全部' : ACCESS_LABEL[value]} <b>{counts[value]}</b></button>)}</div>
    <input type="search" aria-label="搜索项目资源" placeholder="搜索资源、用途、归属…" value={filters.search} onChange={(e) => onChange({ ...filters, search: e.target.value })} /></div>
    <div className="category-row"><span className="muted">资源领域</span>{[['all', '全部领域'], ...Object.entries(CATEGORY_LABEL)].map(([value, label]) => <button key={value} aria-pressed={filters.category === value} onClick={() => onChange({ ...filters, category: value! })}>{label}</button>)}</div>
  </div>;
}
export function ResourceGraph({ ws, filters }: { ws: Workspace; filters: Filters }) {
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const topology = makeTopology(ws.entries, ws.requests, filters.category, ws.scenario === 'partial');
  const matching = new Set(ws.entries.filter((e) => matches(e, ws.requests, filters.category, filters.access, filters.search)).map((e) => e.id));
  const filtered = Boolean(filters.search || filters.access !== 'all');
  const muted = topology.nodes.filter((node) => !matching.has(node.id) && !ws.requests.some((r) => r.id === node.id && matching.has(r.target)));
  const dimCss = filtered ? muted.map((n) => `.topology-stage [data-node-id="${n.id}"] { opacity: .22; }`).join('\n') : '';
  const availableCss = ws.entries.filter((e) => e.access === 'requestable').map((e) => `.topology-stage [data-node-id="${e.id}"] > rect { stroke-dasharray: 6 4; }`).join('\n');
  const selectNode = (id: string | undefined) => id?.startsWith('RQ-') ? ws.setRequestId(id) : ws.setSelected(id);
  return <div className="graph-panel"><style>{dimCss + availableCss}</style>
    <div className="graph-context"><div><span className="boundary-icon">▦</span><strong>订单协作助手</strong><span className="muted">项目边界 · cs-orders</span></div><span className="muted">{filtered ? `${matching.size} 项匹配 · 其余保留关系上下文` : '点击节点查看配额、归属与管理操作'}</span></div>
    <div className="diagram-scroll" tabIndex={0} aria-label="项目资源拓扑画布"><div className="topology-stage" style={{ width: `${zoom * 100}%`, minWidth: `${zoom * 940}px` }}>
      <ResourceTopology topology={topology} selectedId={ws.selected} matching={filtered ? matching : undefined} onSelect={selectNode} />
    </div></div>
    <div className="graph-footer"><div className="legend"><span><i className="legend-line" />已配置 / 已观测</span><span><i className="legend-line dashed" />可申请 / 待生效</span><span>申请中包含已有资源的变更</span></div><div className="zoom"><Button variant="ghost" size="small" onClick={() => setExpanded(true)}>⤢ 展开画布</Button><Button variant="ghost" size="small" aria-label="缩小拓扑" disabled={zoom <= .8} onClick={() => setZoom((z) => Math.max(.8, z - .1))}>−</Button><button onClick={() => setZoom(1)} aria-label="重置拓扑缩放">{Math.round(zoom * 100)}%</button><Button variant="ghost" size="small" aria-label="放大拓扑" disabled={zoom >= 1.6} onClick={() => setZoom((z) => Math.min(1.6, z + .1))}>+</Button></div></div>
    {expanded ? <Dialog title="订单协作助手 · 资源全景" size="large" onClose={() => setExpanded(false)}><div className="expanded-diagram"><p className="muted">{filters.category === 'all' ? '全部资源领域' : CATEGORY_LABEL[filters.category as keyof typeof CATEGORY_LABEL]} · 颜色表示领域；实线为已配置／观测，虚线为可申请／待生效。</p><div className="topology-stage"><ResourceTopology topology={topology} selectedId={ws.selected} matching={filtered ? matching : undefined} onSelect={selectNode} /></div></div></Dialog> : null}
  </div>;
}
function EntryStatus({ entry, ws }: { entry: Entry; ws: Workspace }) {
  const access = accessOf(entry, ws.requests);
  return <><Badge tone={access === 'owned' ? 'success' : access === 'pending' ? 'warning' : 'info'}>{ACCESS_LABEL[access]}</Badge>{entry.access === 'owned' && pendingFor(ws.requests, entry.id) ? <small className="pending-label">配额变更申请中</small> : null}</>;
}
export function ResourceList({ ws, filters }: { ws: Workspace; filters: Filters }) {
  const entries = ws.entries.filter((e) => matches(e, ws.requests, filters.category, filters.access, filters.search));
  return <div className="resource-list"><div className="desktop-list"><DataTable stickyHeader columns={['资源 / 用途', '归属与来源', '配额 / 用量', '授权与运行状态', '操作']}><>{entries.map((e) => <tr key={e.id}><td><strong>{e.title}</strong><small>{CATEGORY_LABEL[e.category]}</small></td><td>{e.owner}<small>{e.source}</small></td><td>{metricsFor(e, ws.scenario === 'partial').map(([k, v]) => <small key={k}>{k}：{v}</small>)}</td><td><EntryStatus entry={e} ws={ws} /><small>{e.stateText}</small></td><td><Button variant="secondary" size="small" onClick={() => ws.setSelected(e.id)}>查看 / 管理</Button></td></tr>)}</></DataTable></div>
    <div className="mobile-list">{entries.map((e) => <button key={e.id} onClick={() => ws.setSelected(e.id)} className="mobile-resource"><div><strong>{e.title}</strong><EntryStatus entry={e} ws={ws} /></div><p>{e.owner}</p>{metricsFor(e, ws.scenario === 'partial').slice(0, 2).map(([k, v]) => <small key={k}>{k} · {v}</small>)}<span className="mobile-more">查看详情与关联 →</span></button>)}</div>
    {!entries.length ? <div className="empty">没有匹配的资源，请调整领域、状态或搜索条件。</div> : null}
  </div>;
}
