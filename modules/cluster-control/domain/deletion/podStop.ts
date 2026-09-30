import type { ContainerStopEvidence } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { ObservedObject } from '../observation';
import { stoppedContainers } from '../workloadStop';
import type { StopNodeEvidence } from '../workloadStop';

export const PROJECT_STOP_FINALIZER = 'crewstation.io/project-delete-stop-proof';
export const PROJECT_STOP_ANNOTATION = 'crewstation.io/project-delete-operation';
export interface ProjectPodIdentity { uid: string; nodeName: string | null; nodeUid: string | null; specDigest: string }
export function originalPodIdentity(value: string): ProjectPodIdentity {
  const identity = JSON.parse(value) as Partial<ProjectPodIdentity>;
  if (!identity.uid || typeof identity.specDigest !== 'string' || !/^[a-f0-9]{64}$/.test(identity.specDigest)
    || identity.nodeName !== null && typeof identity.nodeName !== 'string' || identity.nodeUid !== null && typeof identity.nodeUid !== 'string'
    || !!identity.nodeName !== !!identity.nodeUid) throw precondition('原 Pod 身份材料不完整');
  return identity as ProjectPodIdentity;
}
export function assertProjectPodProtection(pod: ObservedObject, original: ProjectPodIdentity, operationId: string): void {
  const spec = (pod.spec ?? {}) as Parameters<typeof stoppedContainers>[0];
  if (pod.metadata.uid !== original.uid || jsonHash(spec) !== original.specDigest || (spec.nodeName ?? null) !== original.nodeName) throw precondition('原 Pod 配置或实例已被替换');
  if (pod.metadata.annotations?.[PROJECT_STOP_ANNOTATION] !== operationId || !pod.metadata.finalizers?.includes(PROJECT_STOP_FINALIZER)) throw precondition('原 Pod 停止观测保护不完整');
}
export function projectPodTerminated(pod: ObservedObject, original: ProjectPodIdentity, operationId: string, node: StopNodeEvidence | undefined): ContainerStopEvidence[] | undefined {
  assertProjectPodProtection(pod, original, operationId);
  const spec = (pod.spec ?? {}) as Parameters<typeof stoppedContainers>[0], status = (pod.status ?? {}) as Parameters<typeof stoppedContainers>[1];
  if (!pod.metadata.deletionTimestamp) throw precondition('原 Pod 还未进入终结');
  if (original.nodeName) {
    if (!node || node.name !== original.nodeName || node.uid !== original.nodeUid || !node.ready || !node.leaseFresh || Number(/^v1\.(\d+)\./.exec(node.kubeletVersion)?.[1] ?? 0) < 27) return undefined;
    if (status.reason === 'NodeLost' || !['Failed', 'Succeeded'].includes(status.phase ?? '')) return undefined;
  }
  return stoppedContainers(spec, status, !original.nodeName);
}
