import type { Actor, ProjectId, ProjectResourceEdge, ProjectResourceNode, ResourceRecord } from '@crewstation/contracts';
import type { ProjectResourceDetailPorts } from '../../ports/projectResourceSources';
import { allocationId, graphEdge, graphNode, projectResourceId, recordId } from '../../domain/projectResourceGraph';

const categoryOf = (kind: ResourceRecord['kind']): ProjectResourceNode['category'] => ['database', 'data-binding', 'object-space'].includes(kind) ? 'data' : ['service-slot', 'build-job', 'migration-job'].includes(kind) ? 'service' : ['route', 'rate-limit-policy', 'namespace', 'network-policy-set'].includes(kind) ? 'foundation' : 'execution';
export async function ledgerResourceGraph(p: ProjectResourceDetailPorts, actor: Actor, projectId: ProjectId) {
  const rows = (await p.ledger(actor, projectId)).items;
  const selected = rows.slice(0, 2000), edges: ProjectResourceEdge[] = [];
  const nodes = selected.flatMap((record) => {
    const id = recordId(record.id), parent = record.parentId ? recordId(record.parentId) : projectResourceId(projectId), category = categoryOf(record.kind);
    edges.push(graphEdge(parent, id, record.kind === 'volume' ? 'mounts' : 'owns', 'configured', record.kind === 'volume' ? '工作卷' : '归属'));
    if (['dev-workspace', 'agent-execution', 'business-workspace', 'archive-execution'].includes(record.kind) && ['pending', 'provisioning', 'starting', 'ready', 'degraded', 'stopping'].includes(record.phase)) edges.push(graphEdge(id, allocationId(projectId, 'execution-quota', projectId), 'consumes-quota', 'observed', '占用 1 并发单位'));
    if (record.children.some((c) => ['Pod', 'Deployment', 'PersistentVolumeClaim', 'Job'].includes(c.kind))) edges.push(graphEdge(id, allocationId(projectId, 'namespace-quota', projectId), 'consumes-quota', 'configured', '共用命名空间请求额度'));
    const node = graphNode(id, record.display?.name ?? `${record.kind} · ${record.owner.ref.slice(0, 8)}`, record.kind, category, { resourceId: record.id, state: record.phase, stateText: record.phase, description: record.reason?.message ?? '', source: 'observed', ownerId: parent, observedAt: record.updatedAt, stale: Date.now() - Date.parse(record.updatedAt) > 300000, facts: [{ label: '所属领域', value: record.owner.module }, { label: '逻辑引用', value: record.owner.ref }, ...Object.entries(record.display ?? {}).map(([label, value]) => ({ label, value }))] });
    return [node, ...record.children.map((child) => {
      const childId = `physical:${child.kind}:${child.namespace ?? ''}:${child.uid ?? child.name}`;
      edges.push(graphEdge(id, childId, 'owns', 'observed', child.kind));
      return graphNode(childId, child.name, child.kind, category, { resourceId: child.uid ?? null, environment: node.environment, source: 'observed', ownerId: id, state: child.phase, stateText: child.phase, observedAt: child.observedAt ?? null, stale: !child.observedAt || Date.now() - Date.parse(child.observedAt) > 300000, facts: [{ label: 'Kind', value: child.kind }, { label: '命名空间', value: child.namespace ?? '集群' }, { label: 'UID', value: child.uid ?? '尚未观测' }, { label: '就绪', value: child.ready ? '是' : '否' }] });
    })];
  });
  return { nodes, edges, complete: rows.length <= 2000, ...(rows.length > 2000 ? { message: '首屏保留 2000 个资源记录，更多记录请使用标准资源清单' } : {}) };
}
