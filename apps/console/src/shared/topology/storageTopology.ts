import type { ClusterResource, ResourceRecord } from '@crewstation/contracts';
import type { Translate } from '../lib/useT';
import type { TopologyBand, TopologyEdge, TopologyNode } from '../ui/topology/topologyModel';
import { factText } from './topologyText';

export interface TopologyParts { nodes: TopologyNode[]; edges: TopologyEdge[]; bands: TopologyBand[] }
export function resourceNode(parts: TopologyParts, resource: ClusterResource, records: readonly ResourceRecord[] = []): TopologyNode | undefined {
  return parts.nodes.find((node) => node.resourceId === resource.resourceId || node.id === resource.uid || records.some((record) => record.id === node.id && record.children.some((child) => child.uid === resource.uid)));
}
function volumeNode(resource: ClusterResource, band: string, lane: number, t: Translate): TopologyNode {
  return { id: resource.uid, resourceId: resource.resourceId, kind: 'volume', semantic: 'data', title: resource.name, subtitle: resource.kind, lane, band,
    status: resource.deletingAt ? 'terminating' : resource.phase === 'Bound' ? 'ready' : resource.phase === 'Failed' || resource.phase === 'Lost' ? 'failed' : 'pending', statusText: resource.phase || t('topology.status.unknown'), abnormal: resource.abnormal,
    facts: [[t('topology.fact.kind'), resource.kind], [t('topology.fact.uid'), resource.uid], ...Object.entries(resource.facts).map(([k, v]) => [k, factText(v)] as const)],
    meta: [resource.facts.storageClass ?? '', factText(resource.facts.capacity ?? resource.facts.requested ?? '')].filter(Boolean) };
}
function addEdge(parts: TopologyParts, edge: TopologyEdge): void {
  const previous = parts.edges.findIndex((e) => e.from === edge.from && e.to === edge.to && e.kind === edge.kind);
  if (previous < 0) parts.edges.push(edge); else parts.edges[previous] = edge;
}

/** Complete physical storage independently of a task's lifecycle; preserve ledger node IDs. */
export function appendStorage(parts: TopologyParts, resources: readonly ClusterResource[], records: readonly ResourceRecord[], t: Translate, system = false): number {
  let missingBindings = 0;
  const claims = resources.filter((r) => r.kind === 'PersistentVolumeClaim'), volumes = resources.filter((r) => r.kind === 'PersistentVolume');
  const storageBand = () => {
    if (!parts.bands.some((b) => b.id === 'storage')) parts.bands.push({ id: 'storage', title: t('topology.band.storage'), semantic: 'data' });
    return 'storage';
  };
  for (const claim of claims) {
    let node = resourceNode(parts, claim, records);
    const holders = resources.filter((r) => r.references.includes(`${claim.namespace}/PersistentVolumeClaim/${claim.name}`) && r.kind !== 'PersistentVolume')
      .flatMap((r) => { let n = resourceNode(parts, r, records), owner = r;
        for (let hop = 0; system && !n && hop < 8; hop++) { const parent = resources.find((p) => owner.owners.some((o) => o.uid === p.uid)); if (!parent) break; owner = parent; n = resourceNode(parts, parent, records); }
        return n ? [{ resource: r, node: n }] : []; });
    if (!node) { node = volumeNode(claim, system ? storageBand() : holders[0]?.node.band ?? storageBand(), 3, t); parts.nodes.push(node); }
    for (const holder of holders) {
      const paths = holder.resource.mounts?.filter((m) => m.claimName === claim.name).map((m) => `${m.container}${m.init ? ' (init)' : ''}: ${m.mountPath}${m.subPath ? ` [subPath: ${m.subPath}]` : m.subPathExpr ? ` [subPathExpr: ${m.subPathExpr}]` : ''}${m.readOnly ? ' (RO)' : ''}`) ?? [];
      addEdge(parts, { from: holder.node.id, to: node.id, kind: 'mounts', evidence: 'observed', ...(paths.length ? { label: [...new Set(paths)].join('; ') } : {}) });
      if (paths.length) { const index = parts.nodes.indexOf(holder.node); parts.nodes[index] = { ...holder.node, facts: [...(holder.node.facts ?? []), [t('topology.volume.mounts'), paths.join('\n')]] }; }
    }
    const bound = volumes.find((v) => v.facts.claimUid === claim.uid && v.references.includes(`${claim.namespace}/PersistentVolumeClaim/${claim.name}`) && claim.references.includes(`/PersistentVolume/${v.name}`));
    if (claim.facts.volumeName && !bound) missingBindings++;
    if (bound) {
      let pvNode = resourceNode(parts, bound, records);
      if (!pvNode) { pvNode = volumeNode(bound, node.band, 4, t); parts.nodes.push(pvNode); }
      addEdge(parts, { from: node.id, to: pvNode.id, kind: 'binds', evidence: 'observed' });
    }
  }
  for (const volume of volumes) if (!resourceNode(parts, volume, records)) parts.nodes.push(volumeNode(volume, storageBand(), 4, t));
  return missingBindings;
}
