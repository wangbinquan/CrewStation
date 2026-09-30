import type { Actor, ProjectId, ResourceWorkload, ProjectResourceEdge } from '@crewstation/contracts';
import type { ProjectResourceDetailPorts } from '../../ports/projectResourceSources';
import { allocationId, graphEdge, graphNode, projectResourceId, recordId } from '../../domain/projectResourceGraph';
import { imageReferenceGraph } from './imageReferences';

export async function executionResourceGraph(p: ProjectResourceDetailPorts, actor: Actor, projectId: ProjectId) {
  const workloads: ResourceWorkload[] = []; let after: string | undefined, complete = false;
  for (let page = 0; page < 4; page++) { const value = await p.workloads(actor, projectId, { ...(after ? { after } : {}), limit: 250 }); workloads.push(...value.items); if (!value.nextCursor) { complete = true; break; } after = value.nextCursor; }
  const volumes = (await p.ledger(actor, projectId)).items.filter((r) => r.kind === 'volume');
  const edges: ProjectResourceEdge[] = [], nodes = workloads.map((task) => {
    const id = recordId(task.id), ownerId = task.parentTaskId ? recordId(task.parentTaskId) : projectResourceId(projectId);
    edges.push(graphEdge(ownerId, id, 'owns', 'configured', task.parentTaskId ? '工作区内执行' : '项目任务'));
    if (task.taskProfileId) edges.push(graphEdge(id, allocationId(projectId, 'task-profile', task.taskProfileId), 'uses', 'configured', '受理时固定规格'));
    if (task.computeProfileId) edges.push(graphEdge(id, allocationId(projectId, 'compute-profile', task.computeProfileId), 'uses', 'configured', '固定算力档位'));
    if (task.parentTaskId) for (const volume of volumes.filter((v) => v.parentId === task.parentTaskId)) edges.push(graphEdge(id, recordId(volume.id), 'mounts', 'configured', '挂载父工作区工作卷'));
    return graphNode(id, `${task.kind} · ${task.id.slice(0, 8)}`, task.kind === 'dev-session' ? 'dev-workspace' : task.parentTaskId ? 'agent-execution' : 'business-workspace', 'execution', { resourceId: task.id, environment: task.kind === 'dev-session' ? 'development' : 'project', ownerId, state: task.state, stateText: task.state, observedAt: task.updatedAt, source: 'configuration', facts: [{ label: 'CPU 请求', value: task.cpu ?? '未知' }, { label: '内存请求', value: task.memory ?? '未知' }, { label: '工作卷申请容量', value: task.storage ?? '未知' }, { label: '工作卷保留方式', value: task.volumeMode }, { label: 'Pod UID', value: task.podUid ?? '尚未观测' }, ...(task.runtimeImageVersionId ? [{ label: '固定镜像版本', value: task.runtimeImageVersionId }] : [])] });
  });
  const images = await imageReferenceGraph(p, projectId, workloads.flatMap((w) => w.runtimeImageVersionId ? [{ ownerId: recordId(w.id), versionId: w.runtimeImageVersionId, label: '固定镜像版本' }] : []));
  return { nodes: [...nodes, ...images.nodes], edges: [...edges, ...images.edges], complete: complete && images.complete !== false, ...(!complete ? { message: '执行实例首屏上限 1000，更多实例可在工作区与资源清单查看' } : images.message ? { message: images.message } : {}) };
}
