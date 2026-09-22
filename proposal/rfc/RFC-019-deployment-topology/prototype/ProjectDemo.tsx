// 项目侧两处入口：概览页的缩略形态图，运行与诊断页的完整形态页签。
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { DefinitionList } from '../../../../apps/console/src/shared/ui/DefinitionList';
import { PageHeader } from '../../../../apps/console/src/shared/ui/PageHeader';
import { Tabs } from '../../../../apps/console/src/shared/ui/Tabs';
import { TopologyDiagram } from './TopologyDiagram';
import { COMPACT_METRICS } from './topologyLayout';
import { ObservedLine, TopologyDetail, TopologyFilters, TopologyLegend, TopologyList, useNarrow } from './TopologyPanels';
import type { TopologyFilter } from './topologyModel';
import { DEMO_PROJECTS, projectTopology } from './demoData';

export interface ProjectDemoProps { tick: number; partial: boolean; go: (path: string) => void; selected?: string; onSelect: (id: string | undefined) => void }
const demo = DEMO_PROJECTS.find((p) => p.id === 'demo')!;

export function ProjectOverviewDemo({ tick, partial, go, selected, onSelect }: ProjectDemoProps): ReactElement {
  const topology = useMemo(() => projectTopology(demo, tick, partial), [tick, partial]);
  const abnormal = topology.nodes.filter((n) => n.abnormal).length, pods = topology.nodes.filter((n) => n.kind === 'pod');
  const greenReady = tick >= 2;
  return <>
    <PageHeader title="演示数字人" actions={<><Button variant="primary" onClick={() => go('/projects/demo/operations')}>运行与诊断</Button><Button>刷新概览</Button></>} />
    <div className="projectMeta"><code>demo</code><span>数字人</span><Badge tone="success">运行中</Badge><span>负责人 · 林晓</span></div>
    <div className="versionGrid">
      <Card compact title="线上 prod · blue" extra={<Badge tone="success">1／1 就绪</Badge>}><DefinitionList items={[{ label: '版本', value: 'v0.1.4 · 7dee80b' }, { label: '主机', value: 'demo.cs.localhost' }, { label: '切流', value: '2026-09-22 10:38' }]} /></Card>
      <Card compact title="待命 preview · green" extra={<Badge tone={greenReady ? 'success' : 'warning'}>{greenReady ? '1／1 就绪' : '部署中'}</Badge>}><DefinitionList items={[{ label: '版本', value: 'v0.1.5 · 1d88a7d2' }, { label: '主机', value: 'preview.demo.cs.localhost' }, { label: '迁移', value: greenReady ? '已完成' : '运行中' }]} /></Card>
    </div>
    <Card compact title="部署与运行形态" extra={<Button variant="ghost" onClick={() => go('/projects/demo/operations')}>查看完整形态 →</Button>}>
      <p className="topo-summary-line">工作负载 <b>{topology.nodes.filter((n) => n.kind === 'workload' || n.kind === 'job').length}</b> · Pod <b>{pods.length}</b>，就绪 <b>{pods.filter((n) => n.status === 'ready').length}</b>，运行 <b>{pods.filter((n) => n.status === 'running').length}</b>{abnormal ? <> · <Badge tone="warning">{abnormal} 个需要关注</Badge></> : null}</p>
      <TopologyDiagram topology={topology} metrics={COMPACT_METRICS} compact label="演示数字人的部署与运行形态缩略图" selectedId={selected} onSelect={(id) => { onSelect(id); if (id) go('/projects/demo/operations'); }} />
      <p className="topo-muted">点击任一节点进入运行与诊断查看详情。{topology.complete ? '' : ' 部分来源失败，数据与存储列为上次成功结果。'}</p>
    </Card>
    <Card compact title="开发会话" extra={<Button variant="ghost">继续开发 →</Button>}><p>林晓 · 分支 main · Runner 已连接 · {tick >= 1 ? 3 : 2} 个 Agent 运行中</p></Card>
  </>;
}

const OPERATION_TABS = [{ value: 'health', label: '健康' }, { value: 'alerts', label: '告警' }, { value: 'logs', label: '日志' }, { value: 'deliveries', label: '事件投递' }, { value: 'trace', label: '追踪' }, { value: 'topology', label: '部署与运行形态' }];

export function ProjectOperationsDemo({ tick, partial, selected, onSelect }: Omit<ProjectDemoProps, 'go'>): ReactElement {
  const [tab, setTab] = useState('topology');
  const [filter, setFilter] = useState<TopologyFilter>({});
  const topology = useMemo(() => projectTopology(demo, tick, partial), [tick, partial]);
  const narrow = useNarrow();
  return <>
    <PageHeader title="运行与诊断" description="演示数字人 · 线上 v0.1.4 · 待命 v0.1.5" />
    <Tabs label="运行与诊断" value={tab} onChange={setTab} items={OPERATION_TABS}>
      {tab !== 'topology' ? <Card compact><p className="topo-muted">「{OPERATION_TABS.find((t) => t.value === tab)?.label}」沿用现有页面，本设计稿不改动。</p></Card> : <div className="topo-page">
        <ObservedLine topology={topology} />
        <TopologyFilters topology={topology} filter={filter} onChange={setFilter} />
        <div className={`topo-workspace${selected ? ' has-detail' : ''}`}>
          <div className="topo-main">
            {narrow ? <TopologyList topology={topology} selectedId={selected} onSelect={onSelect} filter={filter} /> : <TopologyDiagram topology={topology} label="演示数字人的部署与运行形态" selectedId={selected} onSelect={onSelect} filter={filter} />}
            <TopologyLegend topology={topology} />
          </div>
          {selected ? <TopologyDetail topology={topology} nodeId={selected} onSelect={onSelect} onClose={() => onSelect(undefined)} space="workbench" /> : null}
        </div>
      </div>}
    </Tabs>
  </>;
}
