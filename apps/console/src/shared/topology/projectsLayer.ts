// 集群项目层：每个项目一张卡；需要关注的置顶；正常项目超过 60 个时折叠；列数随宽度。
import type { ClusterProjectCounts } from '@crewstation/contracts';
import type { Translate } from '../lib/useT';
import type { Topology, TopologyNode } from '../ui/topology/topologyModel';

export const FOLD_THRESHOLD = 60, FOLD_SHOWN = 12;
export const MORE_NODE_ID = 'project:more';
export interface ProjectsLayerInput {
  readonly projects: readonly ClusterProjectCounts[];
  readonly columns: number;
  readonly expanded: boolean;
  readonly snapshot: { readonly id: string; readonly observedAt: string; readonly complete: boolean; readonly incompleteReason?: string };
}
export function columnsFor(width: number): number { return width > 0 ? Math.max(2, Math.min(8, Math.floor((width - 36 + 24) / (210 + 24)))) : 4; }

export function buildProjectsLayer(input: ProjectsLayerInput, t: Translate): Topology {
  const columns = Math.max(1, input.columns), complete = input.snapshot.complete;
  const attention = input.projects.filter((p) => (p.abnormal ?? 0) > 0), calm = input.projects.filter((p) => (p.abnormal ?? 0) === 0);
  const fold = input.projects.length > FOLD_THRESHOLD && !input.expanded, shownCalm = fold ? calm.slice(0, FOLD_SHOWN) : calm;
  const card = (p: ClusterProjectCounts, band: string, index: number): TopologyNode => ({
    id: `project:${p.id}`, kind: 'summary', semantic: 'service', title: p.name, subtitle: p.id, lane: index % columns, row: Math.floor(index / columns), band, abnormal: (p.abnormal ?? 0) > 0,
    status: !complete || p.pods === undefined ? 'unknown' : (p.abnormal ?? 0) > 0 ? 'pending' : p.pods === 0 ? 'idle' : 'ready',
    statusText: p.pods === undefined ? t('topology.status.unknown') : (p.abnormal ?? 0) > 0 ? t('topology.summary.attention', { count: p.abnormal ?? 0 }) : t('topology.summary.podsReady', { pods: p.pods, ready: p.readyPods ?? 0 }),
    counts: [[t('topology.projects.workloads'), p.workloads === undefined ? '—' : String(p.workloads)], [t('topology.summary.pods'), p.pods === undefined ? t('topology.projects.unknownCount') : t('topology.summary.podsReady', { pods: p.pods, ready: p.readyPods ?? 0 })], [t('topology.projects.devSessions'), p.devSessions === undefined ? '—' : String(p.devSessions)]],
    facts: [[t('topology.projects.projectId'), p.id], [t('topology.projects.workloads'), p.workloads === undefined ? '—' : String(p.workloads)], [t('topology.summary.pods'), p.pods === undefined ? '—' : `${p.pods} · ${p.readyPods ?? 0}`], [t('topology.projects.abnormal'), p.abnormal === undefined ? '—' : String(p.abnormal)], [t('topology.projects.devSessions'), p.devSessions === undefined ? '—' : String(p.devSessions)]],
  });
  const nodes = [...attention.map((p, i) => card(p, 'attention', i)), ...shownCalm.map((p, i) => card(p, 'calm', i))];
  if (fold) nodes.push({ id: MORE_NODE_ID, kind: 'summary', semantic: 'platform', title: t('topology.projects.more', { count: calm.length - shownCalm.length }), subtitle: t('topology.projects.moreHint'), status: 'idle', statusText: t('topology.projects.folded'), lane: shownCalm.length % columns, row: Math.floor(shownCalm.length / columns), band: 'calm' });
  return {
    id: 'projects', title: t('topology.projects.title'), lanes: Array.from({ length: columns }, () => ''),
    bands: [...(attention.length > 0 ? [{ id: 'attention', title: t('topology.projects.attention', { count: attention.length }), semantic: 'business' as const }] : []), { id: 'calm', title: fold ? t('topology.projects.calmFolded', { count: calm.length, shown: shownCalm.length }) : t('topology.projects.calm', { count: calm.length }), semantic: 'service' as const }],
    nodes, edges: [], observedAt: input.snapshot.observedAt, complete, incompleteReason: input.snapshot.incompleteReason,
  };
}
