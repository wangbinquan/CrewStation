// 集群管理页新增「拓扑」页签：系统层 → 项目层 → Pod 层；点选节点打开右侧详情；计数口径沿用 RFC-010。
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { PageHeader } from '../../../../apps/console/src/shared/ui/PageHeader';
import { Tabs } from '../../../../apps/console/src/shared/ui/Tabs';
import { TopologyDiagram } from './TopologyDiagram';
import { SUMMARY_METRICS } from './topologyLayout';
import { ObservedLine, TopologyDetail, TopologyFilters, TopologyLegend, TopologyList, useNarrow } from './TopologyPanels';
import type { TopologyFilter } from './topologyModel';
import { DEMO_PROJECTS, manyProjects, projectLayerTopology, projectTopology, systemTopology } from './demoData';

const CLUSTER_TABS = ['工作负载', 'Pod', '网络', '存储与配置', '节点', '最近 7 天趋势', '命名空间', '操作记录'].map((label) => ({ value: label, label }));
type Layer = 'system' | 'projects' | `project:${string}`;

export interface ClusterDemoProps { tick: number; partial: boolean; many: boolean; selected?: string; onSelect: (id: string | undefined) => void }

export function ClusterDemo({ tick, partial, many, selected, onSelect }: ClusterDemoProps): ReactElement {
  const [tab, setTab] = useState('topology');
  const [layer, setLayer] = useState<Layer>('system');
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<TopologyFilter>({});
  const projects = useMemo(() => (many ? manyProjects() : DEMO_PROJECTS), [many]);
  const narrow = useNarrow();
  const projectId = layer.startsWith('project:') ? layer.slice('project:'.length) : undefined;
  const project = projects.find((p) => p.id === projectId);
  const topology = useMemo(() => layer === 'system' ? systemTopology(partial) : layer === 'projects' ? projectLayerTopology(projects, partial, expanded) : projectTopology(project ?? DEMO_PROJECTS.find((p) => p.id === 'demo')!, tick, partial), [layer, partial, projects, expanded, project, tick]);
  const switchLayer = (next: Layer) => { setLayer(next); onSelect(undefined); setFilter({}); };
  const select = (id: string | undefined) => { if (id === 'project:more') { setExpanded(true); return; } onSelect(id); };
  const pods = partial ? '—' : many ? '257' : '38';
  const cards = [['工作负载', many ? '241' : '27'], ['Pod 总数', pods], ['Service', many ? '260' : '35'], ['工作卷 PVC', partial ? '—' : many ? '131' : '14'], ['异常 Pod', many ? '9' : '4']];
  return <>
    <PageHeader title="集群管理" description="项目与平台内置资源的数量、状态、归属和 Pod 用途；受控的重启、扩缩与删除。" actions={<Button>手动刷新</Button>} />
    <div className="clusterCards">{cards.map(([label, value]) => <button type="button" key={label} className="clusterStat"><span>{label}</span><strong>{value}</strong><span>{partial && value === '—' ? '部分来源失败' : '已受管'}</span></button>)}</div>
    <Tabs label="资源" value={tab} onChange={setTab} items={[{ value: 'topology', label: '拓扑' }, ...CLUSTER_TABS]}>
      {tab !== 'topology' ? <Card compact><p className="topo-muted">「{tab}」沿用现有页面，本设计稿不改动。</p></Card> : <div className="topo-page">
        <div className="topo-layers" role="group" aria-label="层级">
          <Button variant={layer === 'system' ? 'secondary' : 'ghost'} aria-pressed={layer === 'system'} onClick={() => switchLayer('system')}>系统层</Button>
          <Button variant={layer === 'projects' ? 'secondary' : 'ghost'} aria-pressed={layer === 'projects'} onClick={() => switchLayer('projects')}>项目层 · {projects.length}</Button>
          <Button variant={projectId ? 'secondary' : 'ghost'} aria-pressed={!!projectId} disabled={!projectId} onClick={() => projectId && switchLayer(layer)}>Pod 层{project ? ` · ${project.name}` : ''}</Button>
          {projectId ? <span className="topo-breadcrumb">项目层 › {project?.name} · <code>{project?.namespace}</code> <Button variant="ghost" onClick={() => switchLayer('projects')}>返回项目层</Button></span> : null}
        </div>
        <ObservedLine topology={topology} />
        {layer === 'system' ? <p className="topo-muted">节点状态来自集群盘点；虚线调用关系是静态架构标注，不是实测流量。</p> : null}
        {layer !== 'projects' ? <TopologyFilters topology={topology} filter={filter} onChange={setFilter} /> : <p className="topo-muted">异常项目置顶；正常项目超过 60 个时折叠，点击「还有 N 个」展开。点选项目卡片后可在详情里展开它的 Pod 层。</p>}
        <div className={`topo-workspace${selected ? ' has-detail' : ''}`}>
          <div className="topo-main">
            {narrow ? <TopologyList topology={topology} selectedId={selected} onSelect={select} filter={filter} /> : <TopologyDiagram key={topology.id} topology={topology} metrics={layer === 'projects' ? SUMMARY_METRICS : undefined} label={topology.title} selectedId={selected} onSelect={select} filter={filter} />}
            {layer !== 'projects' ? <TopologyLegend topology={topology} /> : null}
          </div>
          {selected ? <TopologyDetail topology={topology} nodeId={selected} onSelect={select} onClose={() => onSelect(undefined)} space="admin" onOpenProject={(id) => switchLayer(`project:${id}`)} /> : null}
        </div>
      </div>}
    </Tabs>
  </>;
}
