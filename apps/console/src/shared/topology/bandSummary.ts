// 概览缩略：每条横带汇成一张卡（最差状态、Pod 与就绪数、需要关注数），一行铺满宽度；点卡片进完整形态。
import type { Translate } from '../lib/useT';
import type { Topology, TopologyNode } from '../ui/topology/topologyModel';
import { statusCounts, worstStatus } from '../ui/topology/topologyModel';

export function bandSummaryTopology(topology: Topology, t: Translate): Topology {
  const nodes: TopologyNode[] = topology.bands.map((band, lane) => {
    const members = topology.nodes.filter((node) => node.band === band.id), pods = members.filter((node) => node.kind === 'pod');
    const worst = worstStatus(members), abnormal = members.filter((node) => node.abnormal).length;
    const byStatus = statusCounts(members).map(([status, count]) => `${count} ${t(`topology.status.${status}`)}`).join(' · ');
    return {
      id: `band:${band.id}`, kind: 'summary', semantic: band.semantic, title: band.title, subtitle: band.note, status: worst, lane, band: 'summary', abnormal: abnormal > 0,
      statusText: abnormal > 0 ? t('topology.summary.attention', { count: abnormal }) : t(`topology.status.${worst}`),
      counts: [[t('topology.summary.pods'), pods.length > 0 ? t('topology.summary.podsReady', { pods: pods.length, ready: pods.filter((pod) => pod.status === 'ready').length }) : t('topology.summary.none')], [t('topology.summary.status'), byStatus || t('topology.summary.none')], [t('topology.summary.nodes'), String(members.length)]],
    };
  });
  return { ...topology, id: `${topology.id}:summary`, lanes: topology.bands.map(() => ''), bands: [{ id: 'summary', title: '', semantic: 'platform' }], nodes, edges: [] };
}
