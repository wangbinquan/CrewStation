import type { ProjectId } from '@crewstation/contracts';
import type { ProjectResourceDetailPorts, ProjectResourceFragment } from '../../ports/projectResourceSources';
import { allocationId, graphEdge, graphNode } from '../../domain/projectResourceGraph';

/** Resolve immutable versions once, keeping other resource facts when one version is unavailable. */
export async function imageReferenceGraph(p: ProjectResourceDetailPorts, projectId: ProjectId, references: Array<{ ownerId: string; versionId: string; label: string }>): Promise<ProjectResourceFragment> {
  const nodes: ProjectResourceFragment['nodes'] = [], edges: ProjectResourceFragment['edges'] = [], ids = [...new Set(references.map((r) => r.versionId))], failures: string[] = [];
  for (let offset = 0; offset < ids.length; offset += 4) {
    const results = await Promise.allSettled(ids.slice(offset, offset + 4).map((id) => p.imageVersion(p.actor, projectId, id)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') { failures.push(ids[offset + index]!); return; }
      const version = result.value, id = `image-version:${version.id}`, image = allocationId(projectId, 'runtime-image', version.imageId);
      nodes.push(graphNode(id, `镜像版本 ${version.id.slice(0, 8)}`, 'runtime-image-version', 'execution', { resourceId: version.id, kind: 'component', state: version.state, stateText: version.state, facts: [{ label: '固定摘要', value: version.digest }], ownerId: image }));
      edges.push(graphEdge(image, id, 'owns', 'configured', '目录版本'));
      for (const ref of references.filter((r) => r.versionId === version.id)) edges.push(graphEdge(ref.ownerId, id, 'uses', 'configured', ref.label));
    });
  }
  return { nodes, edges, complete: failures.length === 0, ...(failures.length ? { message: `${failures.length} 个固定镜像版本暂不可读取，其余实例与归属已保留` } : {}) };
}
