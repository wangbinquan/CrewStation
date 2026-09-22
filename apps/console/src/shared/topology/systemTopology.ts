// 集群系统层：平台组件的观测状态（盘点）＋ 项目命名空间的聚合卡（摘要）＋ 静态架构标注（常量表）。
import type { ClusterResource, ClusterSummary } from '@crewstation/contracts';
import type { Translate } from '../lib/useT';
import type { Topology, TopologyEdge, TopologyNode } from '../ui/topology/topologyModel';
import { STATIC_COMPONENTS, STATIC_EDGES, STATIC_EXTERNALS, SYSTEM_LANES } from './staticArchitecture';
import { workloadStatus } from './topologyText';

export interface SystemTopologyInput {
  readonly resources: readonly ClusterResource[];
  readonly summary?: ClusterSummary;
  readonly snapshot: { readonly id: string; readonly observedAt: string; readonly complete: boolean; readonly incompleteReason?: string };
}
const sum = (purposes: Record<string, number> | undefined, keys: readonly string[]) => keys.reduce((total, key) => total + (purposes?.[key] ?? 0), 0);

export function buildSystemTopology(input: SystemTopologyInput, t: Translate): Topology {
  const band = 'system', box = 'system', purposes = input.summary?.purposes, complete = input.snapshot.complete;
  const count = (keys: readonly string[]) => (complete ? String(sum(purposes, keys)) : '—');
  const nodes: TopologyNode[] = [
    { id: 'users', kind: 'external', semantic: 'external', title: t('topology.system.users'), subtitle: t('topology.system.usersSub'), status: 'idle', statusText: '—', lane: 0, band, row: 0 },
    { id: 'slots', kind: 'summary', semantic: 'service', title: t('topology.system.slots'), subtitle: t('topology.system.slotsSub', { projects: input.summary?.projects.length ?? 0 }), status: complete ? 'ready' : 'unknown', statusText: t('topology.system.pods', { count: count(['digital-worker-service', 'api-proxy', 'event-producer']) }), lane: 0, band, row: 1, counts: [[t('cluster.purpose.digital-worker-service'), count(['digital-worker-service'])], [t('topology.system.integrations'), count(['api-proxy', 'event-producer'])]] },
    { id: 'sessions', kind: 'summary', semantic: 'development', title: t('topology.system.sessions'), subtitle: t('topology.system.sessionsSub'), status: complete ? (sum(purposes, ['development-workspace']) > 0 ? 'running' : 'idle') : 'unknown', statusText: t('topology.system.pods', { count: count(['development-workspace', 'development-cli', 'development-agent']) }), lane: 0, band, row: 2, counts: [[t('cluster.purpose.development-workspace'), count(['development-workspace'])], [t('topology.system.agents'), count(['development-cli', 'development-agent'])]] },
    { id: 'subtasks', kind: 'summary', semantic: 'business', title: t('topology.system.subtasks'), subtitle: t('topology.system.subtasksSub'), status: complete ? (sum(purposes, ['business-workspace', 'business-subtask']) > 0 ? 'running' : 'idle') : 'unknown', statusText: t('topology.system.pods', { count: count(['business-workspace', 'business-subtask']) }), lane: 0, band, row: 3 },
    { id: 'jobs', kind: 'summary', semantic: 'build', title: t('topology.system.jobs'), subtitle: t('topology.system.jobsSub'), status: complete ? (sum(purposes, ['build', 'migration']) > 0 ? 'running' : 'idle') : 'unknown', statusText: t('topology.system.pods', { count: count(['build', 'migration']) }), lane: 0, band, row: 4 },
  ];
  for (const component of STATIC_COMPONENTS) {
    const observed = input.resources.find((r) => component.names.includes(r.name) && r.view === 'workloads' && r.topLevel);
    const state = observed ? workloadStatus(observed, t) : { status: complete ? 'unknown' as const : 'unknown' as const, statusText: t('topology.system.notObserved') };
    nodes.push({ id: component.id, kind: component.kind, semantic: component.semantic, title: observed?.name ?? component.names[0]!, subtitle: t(component.subtitleKey), status: state.status, statusText: state.statusText, lane: component.lane, band, row: component.row, box, abnormal: observed?.abnormal, resourceId: observed?.resourceId,
      meta: observed ? [observed.kind, t('topology.pod.restarts', { count: observed.restarts })] : [t('topology.system.notObserved')], facts: observed ? [[t('topology.fact.kind'), observed.kind], [t('topology.workload.replicasLabel'), `${observed.readyReplicas ?? 0}／${observed.desired ?? 0}`], [t('topology.fact.restarts'), String(observed.restarts)], [t('topology.fact.uid'), observed.uid]] : [] });
  }
  for (const external of STATIC_EXTERNALS) nodes.push({ id: external.id, kind: 'external', semantic: 'external', title: t(external.titleKey), subtitle: t(external.subtitleKey), status: 'idle', statusText: t('topology.system.external'), lane: 4, band, row: external.row });
  const edges: TopologyEdge[] = STATIC_EDGES.map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind, evidence: 'static', ...(edge.labelKey ? { label: t(edge.labelKey) } : {}) }));
  return { id: 'system', title: t('topology.system.title'), lanes: SYSTEM_LANES.map((lane) => t(`topology.lane.${lane}`)), bands: [{ id: band, title: t('topology.system.cluster'), semantic: 'platform', boxes: [{ id: box, title: t('topology.system.namespace'), semantic: 'platform', note: t('topology.system.namespaceNote', { count: input.resources.filter((r) => r.view === 'workloads' && r.topLevel).length }) }] }], nodes, edges, observedAt: input.snapshot.observedAt, complete, incompleteReason: input.snapshot.incompleteReason };
}
