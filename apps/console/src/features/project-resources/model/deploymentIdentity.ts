import type { ClusterResource, ProjectResourceSnapshot, ResourceRecord } from '@crewstation/contracts';
import type { ProjectTopologyInput } from '../../../shared/topology/projectTopology';
import type { TopologyNode } from '../../../shared/ui/topology/topologyModel';
import { physicalWorkloadOwner } from '../../../shared/topology/physicalIdentity';

/** No names, translated fact labels or shared namespace are identity joins. */
export function deploymentIdentity(node: TopologyNode, input: ProjectTopologyInput, snapshot: ProjectResourceSnapshot) {
  const records = input.records ?? [], physical = input.resources.find((r) => r.uid === node.id || r.resourceId === node.resourceId);
  const record = records.find((r) => r.id === node.id) ?? uniqueOwner(records, physical);
  const database = node.id.startsWith('db:') ? input.dataResources.find((d) => d.env === node.id.slice(3) && d.kind === 'postgres') : undefined;
  const ids = new Set([node.id, ...(physical ? [physical.uid] : []), ...(record ? [record.id] : []), ...(database ? [database.id] : [])]);
  const anchors = snapshot.nodes.filter((n) => n.id.startsWith('resource:') && ids.has(n.resourceId ?? '')
    || n.id.startsWith('physical:') && !!physical && n.resourceId === physical.uid
    || ['database', 'object-space'].includes(n.resourceType) && ids.has(n.resourceId ?? '')).map((n) => n.id);
  const releaseId = physical?.releaseId ?? record?.display?.releaseId;
  if (releaseId && snapshot.nodes.some((n) => n.id === `release:${releaseId}`)) anchors.push(`release:${releaseId}`);
  const controller = physical && physicalWorkloadOwner(physical, input.resources), controllerRecord = uniqueOwner(records, controller);
  const group = record?.kind === 'service-slot' ? record.id : controllerRecord?.kind === 'service-slot' ? controllerRecord.id : controller?.uid ?? node.id;
  const namespace = physical ? physical.namespace === input.project.namespace && physical.kind !== 'PersistentVolume'
    : !!record && record.children.some((child) => child.phase !== 'absent' && !!child.uid && child.namespace === input.project.namespace && ['Pod', 'Deployment', 'Job', 'PersistentVolumeClaim'].includes(child.kind));
  return { group, anchors: [...new Set(anchors)], namespace, record };
}

function uniqueOwner(records: readonly ResourceRecord[], physical: ClusterResource | undefined) {
  if (!physical) return undefined;
  const owners = records.filter((r) => r.children.some((child) => child.uid === physical.uid && child.phase !== 'absent'));
  return owners.length === 1 ? owners[0] : undefined;
}
