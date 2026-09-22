import type { Topology, TopologyNode } from '../shared/ui/topology/topologyModel';

/** 形态图用例共用的小夹具：三条泳道、两条横带、一对反向边、一条同泳道的从属边。 */
const node = (id: string, lane: number, band: string, extra: Partial<TopologyNode> = {}): TopologyNode => ({ id, kind: 'pod', semantic: 'service', title: id, status: 'ready', lane, band, ...extra });
export const layoutFixture: Topology = {
  id: 'fixture', title: '排布夹具', lanes: ['入口', '工作负载', 'Pod'],
  bands: [{ id: 'b1', title: '线上槽 prod · blue', semantic: 'service', note: 'v0.1.4 · 切流于 10:38' }, { id: 'b2', title: '开发会话', semantic: 'development' }],
  nodes: [node('route', 0, 'b1', { kind: 'route', semantic: 'gateway' }), node('deploy', 1, 'b1', { kind: 'workload', box: 'x' }), node('pod', 2, 'b1', { box: 'x' }),
    node('ws', 2, 'b2', { semantic: 'development', status: 'running' }), node('cli', 2, 'b2', { semantic: 'development', status: 'pending', row: 2, abnormal: true })],
  edges: [{ from: 'route', to: 'deploy', kind: 'routes', label: '线上流量', evidence: 'observed' }, { from: 'deploy', to: 'pod', kind: 'owns', evidence: 'observed' }, { from: 'ws', to: 'cli', kind: 'child', evidence: 'observed' },
    { from: 'pod', to: 'route', kind: 'traffic', evidence: 'static' }, { from: 'route', to: 'pod', kind: 'traffic', evidence: 'static' }],
  observedAt: '2026-09-22T12:00:00.000Z', complete: true,
};
