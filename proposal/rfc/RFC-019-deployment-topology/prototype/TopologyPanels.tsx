// 形态图周边面板：图例、筛选、窄屏列表、详情。复用生产的 Card／Tabs／Badge／DefinitionList／Button。
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { DefinitionList } from '../../../../apps/console/src/shared/ui/DefinitionList';
import { Tabs } from '../../../../apps/console/src/shared/ui/Tabs';
import type { NodeStatus, Semantic, Topology, TopologyFilter } from './topologyModel';
import { EDGE_LABEL, SEMANTIC_LABEL, STATUS_LABEL, matchesFilter, semanticCounts, statusCounts, statusTone } from './topologyModel';
import { demoContainers, demoEvents } from './demoData';

export function useNarrow(maxWidth = 640): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => { const media = window.matchMedia(query); const sync = () => setNarrow(media.matches); media.addEventListener('change', sync); return () => media.removeEventListener('change', sync); }, [query]);
  return narrow;
}

export function TopologyLegend({ topology }: { topology: Topology }): ReactElement {
  const edgeKinds = [...new Set(topology.edges.map((edge) => edge.kind))];
  const hasStatic = topology.edges.some((edge) => edge.evidence === 'static'), hasObserved = topology.edges.some((edge) => edge.evidence === 'observed');
  return <div className="topo-legend" aria-label="图例">
    <div className="topo-legend-group"><span className="topo-legend-heading">语义</span>{semanticCounts(topology).map(({ semantic, count }) => <span key={semantic} className={`topo-legend-item sem-${semantic}`}><i className="topo-swatch" />{SEMANTIC_LABEL[semantic]}<b>{count}</b></span>)}</div>
    <div className="topo-legend-group"><span className="topo-legend-heading">状态</span>{statusCounts(topology).map(([status, count]) => <span key={status} className={`topo-legend-item status-${status}`}><i className="topo-dot" />{STATUS_LABEL[status]}<b>{count}</b></span>)}</div>
    {edgeKinds.length > 0 ? <div className="topo-legend-group"><span className="topo-legend-heading">连线</span>{edgeKinds.map((kind) => <span key={kind} className={`topo-legend-item edge-${kind}`}><i className="topo-line" />{EDGE_LABEL[kind]}</span>)}{hasObserved ? <span className="topo-legend-item"><i className="topo-line" />实线为观测到的关系</span> : null}{hasStatic ? <span className="topo-legend-item"><i className="topo-line topo-line-static" />虚线为静态架构标注，不是实测</span> : null}</div> : null}
  </div>;
}

export function TopologyFilters({ topology, filter, onChange }: { topology: Topology; filter: TopologyFilter; onChange: (next: TopologyFilter) => void }): ReactElement {
  const toggle = <T,>(set: ReadonlySet<T> | undefined, value: T): ReadonlySet<T> => { const next = new Set(set); if (next.has(value)) next.delete(value); else next.add(value); return next; };
  const abnormal = topology.nodes.filter((node) => node.abnormal).length;
  return <div className="topo-filters" role="group" aria-label="筛选">
    <span className="topo-filters-label">用途</span>
    {semanticCounts(topology).map(({ semantic }) => <button key={semantic} type="button" className={`topo-chip sem-${semantic}`} aria-pressed={filter.semantics?.has(semantic) ?? false} onClick={() => onChange({ ...filter, semantics: toggle<Semantic>(filter.semantics, semantic) })}><i className="topo-swatch" />{SEMANTIC_LABEL[semantic]}</button>)}
    <span className="topo-filters-label">状态</span>
    {statusCounts(topology).map(([status]) => <button key={status} type="button" className={`topo-chip status-${status}`} aria-pressed={filter.statuses?.has(status) ?? false} onClick={() => onChange({ ...filter, statuses: toggle<NodeStatus>(filter.statuses, status) })}><i className="topo-dot" />{STATUS_LABEL[status]}</button>)}
    <button type="button" className="topo-chip topo-chip-attention" aria-pressed={filter.abnormalOnly ?? false} disabled={abnormal === 0} onClick={() => onChange({ ...filter, abnormalOnly: !filter.abnormalOnly })}>只看需要关注 {abnormal > 0 ? `(${abnormal})` : ''}</button>
    {(filter.semantics?.size || filter.statuses?.size || filter.abnormalOnly) ? <Button variant="ghost" onClick={() => onChange({})}>清除筛选</Button> : null}
  </div>;
}

/** 窄屏（≤640px）不画 SVG：按横带分组的列表，语义与状态提示一致。 */
export function TopologyList({ topology, selectedId, onSelect, filter }: { topology: Topology; selectedId?: string; onSelect: (id: string | undefined) => void; filter?: TopologyFilter }): ReactElement {
  return <div className="topo-list">
    {topology.bands.map((band) => {
      const members = topology.nodes.filter((node) => node.band === band.id && (!filter || matchesFilter(node, filter)));
      if (members.length === 0) return null;
      return <section key={band.id} className={`topo-list-band sem-${band.semantic}`} aria-label={band.title}>
        <h3 className="topo-list-title"><i className="topo-swatch" />{band.title}{band.note ? <small> · {band.note}</small> : null}</h3>
        <ul>{members.map((node) => <li key={node.id}><button type="button" className={`topo-list-row sem-${node.semantic} status-${node.status}${node.id === selectedId ? ' is-selected' : ''}`} aria-pressed={node.id === selectedId} onClick={() => onSelect(node.id === selectedId ? undefined : node.id)}>
          <i className="topo-dot" /><span className="topo-list-main"><strong>{node.title}</strong>{node.subtitle ? <small>{node.subtitle}</small> : null}</span><span className="topo-list-status">{node.statusText ?? STATUS_LABEL[node.status]}{node.abnormal ? ' ⚠' : ''}</span>
        </button></li>)}</ul>
      </section>;
    })}
  </div>;
}

export interface TopologyDetailProps { topology: Topology; nodeId: string; onSelect: (id: string | undefined) => void; onClose: () => void; space: 'workbench' | 'admin'; onOpenProject?: (projectId: string) => void }

export function TopologyDetail({ topology, nodeId, onSelect, onClose, space, onOpenProject }: TopologyDetailProps): ReactElement | null {
  const [tab, setTab] = useState('overview');
  const node = topology.nodes.find((n) => n.id === nodeId);
  useEffect(() => { setTab('overview'); }, [nodeId]);
  if (!node) return null;
  const related = topology.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId).map((edge) => ({ edge, other: topology.nodes.find((n) => n.id === (edge.from === nodeId ? edge.to : edge.from))!, outgoing: edge.from === nodeId }));
  const containers = demoContainers(node), events = demoEvents(node);
  const projectId = node.id.startsWith('project:') ? node.id.slice('project:'.length) : undefined;
  const items = [{ value: 'overview', label: '概览' }, { value: 'related', label: `关联 ${related.length}` }, ...(containers.length ? [{ value: 'containers', label: '容器' }] : []), { value: 'events', label: '事件' }];
  return <Card title={node.title} extra={<Button onClick={onClose}>关闭</Button>} className="topo-detail" stacked>
    <p className={`topo-detail-line sem-${node.semantic}`}><i className="topo-swatch" />{SEMANTIC_LABEL[node.semantic]}{node.subtitle ? ` · ${node.subtitle}` : ''} <Badge tone={statusTone(node.status)}>{node.statusText ?? STATUS_LABEL[node.status]}</Badge>{node.abnormal ? <Badge tone="warning">需要关注</Badge> : null}</p>
    <Tabs label="节点详情" value={tab} onChange={setTab} items={items}>
      {tab === 'overview' ? <div className="topo-detail-stack">
        <DefinitionList items={[...(node.facts ?? []).map(([label, value]) => ({ label, value })), ...(node.meta ? [{ label: '事实', value: node.meta.join(' · ') }] : [])]} />
        <div className="topo-detail-actions">
          {projectId && onOpenProject && projectId !== 'more' ? <Button variant="primary" onClick={() => onOpenProject(projectId)}>展开该项目的 Pod 层</Button> : null}
          {space === 'admin' && node.kind === 'pod' ? <Button>在集群管理中打开 ↗</Button> : null}
          {space === 'workbench' && (node.kind === 'pod' || node.kind === 'job') ? <Button>查看日志 ↗</Button> : null}
          {space === 'workbench' && node.semantic === 'development' ? <Button>打开开发会话 ↗</Button> : null}
          {space === 'workbench' && node.kind === 'workload' ? <Button>发布与上线 ↗</Button> : null}
        </div>
        <p className="topo-muted">管理动作（重启、扩缩、删除）仍在集群管理的资源详情里，这里只读。</p>
      </div> : null}
      {tab === 'related' ? <ul className="topo-related">{related.length === 0 ? <li className="topo-muted">没有观测到与其他节点的关系。</li> : related.map(({ edge, other, outgoing }) => <li key={`${edge.from}-${edge.to}`}><button type="button" className={`topo-list-row sem-${other.semantic} status-${other.status}`} onClick={() => onSelect(other.id)}><i className="topo-dot" /><span className="topo-list-main"><strong>{other.title}</strong><small>{outgoing ? '→ ' : '← '}{EDGE_LABEL[edge.kind]}{edge.label ? ` · ${edge.label}` : ''}{edge.evidence === 'static' ? ' · 静态标注' : ''}</small></span></button></li>)}</ul> : null}
      {tab === 'containers' ? <table className="topo-table"><thead><tr><th>容器</th><th>镜像</th><th>就绪</th><th>重启</th><th>状态</th></tr></thead><tbody>{containers.map((c) => <tr key={c.name}><td>{c.name}</td><td><code>{c.image}</code></td><td>{c.ready ? '是' : '否'}</td><td>{c.restarts}</td><td>{c.state}</td></tr>)}</tbody></table> : null}
      {tab === 'events' ? <ul className="topo-events">{events.map((e, i) => <li key={i}><strong>{e.type} · {e.reason}</strong><span>{e.message}</span><small>{e.at}</small></li>)}</ul> : null}
    </Tabs>
  </Card>;
}

export function ObservedLine({ topology }: { topology: Topology }): ReactElement {
  return <p className={`topo-observed${topology.complete ? '' : ' topo-observed-partial'}`}>
    {topology.complete ? '快照完整' : `部分来源失败：${topology.incompleteReason ?? ''}`} · 观测于 {new Date(topology.observedAt).toLocaleTimeString()} · 每 15 秒换一份快照，节点位置按 UID 固定
  </p>;
}
