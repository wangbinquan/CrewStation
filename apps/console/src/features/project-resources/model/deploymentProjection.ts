import type { Translate } from '../../../shared/lib/useT';
import type { Topology } from '../../../shared/ui/topology/topologyModel';
import type { DeploymentGraph, DeploymentView } from './deploymentGraph';
import { matches } from './workspace';
import type { CenterSearch } from './workspace';

export const DEPLOYMENT_PAGE_SIZE = 20;
export function deploymentProjection(graph: DeploymentGraph, view: DeploymentView, search: CenterSearch, t: Translate) {
  const matched = [...graph.objects.values()].filter((object) => object.views.has(view) && ((!search.category && !search.access && !search.q)
    || object.permissions.some((permission) => matches(permission, search)) || !search.category && !search.access && !!search.q && `${object.node.title} ${object.node.subtitle ?? ''}`.toLocaleLowerCase().includes(search.q.toLocaleLowerCase())));
  const retained = new Set(matched.map((object) => object.node.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.relations) if (retained.has(edge.to) && !retained.has(edge.from) && graph.objects.get(edge.from)?.views.has(view)) { retained.add(edge.from); changed = true; }
  }
  const matching = [...graph.objects.values()].filter((object) => retained.has(object.node.id));
  const pages = Math.max(1, Math.ceil(matching.length / DEPLOYMENT_PAGE_SIZE)), page = Math.min(search.page ?? 1, pages), shown = matching.slice((page - 1) * DEPLOYMENT_PAGE_SIZE, page * DEPLOYMENT_PAGE_SIZE);
  const ids = new Set(shown.map((object) => object.node.id)), edges = new Map();
  for (const edge of graph.relations) if (edge.from !== edge.to && ids.has(edge.from) && ids.has(edge.to)) edges.set(`${edge.from}:${edge.to}:${edge.kind}:${edge.evidence}:${edge.label ?? ''}`, edge);
  const topology: Topology = { ...graph.original, id: `deployment:${view}`, title: t('resourceCenter.deployment.title'),
    lanes: [t('resourceCenter.deployment.entry'), t('resourceCenter.deployment.workloads'), t('resourceCenter.deployment.data'), t('resourceCenter.deployment.dependencies')],
    bands: [{ id: 'architecture', title: '', semantic: 'service', boxes: [{ id: 'namespace', title: t('resourceCenter.deployment.namespace'), semantic: 'security' }] }],
    nodes: shown.map((object) => ({ ...object.node, band: 'architecture', row: undefined, box: object.namespace ? 'namespace' : undefined,
      lane: object.node.kind === 'route' || object.node.id.startsWith('deployment:release:') ? 0 : ['database', 'object-space', 'volume'].includes(object.node.kind) ? 2 : object.node.kind === 'external' ? 3 : 1 })),
    edges: [...edges.values()], complete: graph.original.complete && pages === 1,
    incompleteReason: [graph.original.incompleteReason, ...(pages > 1 ? [t('resourceCenter.deployment.pageCount', { page, pages, count: matching.length })] : [])].filter(Boolean).join(' · ') };
  return { topology, page, pages, count: matching.length };
}
