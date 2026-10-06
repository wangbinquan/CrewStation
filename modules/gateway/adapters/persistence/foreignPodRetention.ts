import type { ProjectDeletionCurrentAssets, ProjectDeletionTarget } from '@crewstation/contracts';
import { LABELS } from '@crewstation/k8s';
import type { DirectoryService } from '../../ports/directories';
import type { GatewayCurrentDevelopment } from '../../ports/repositories';

type Current = Awaited<ReturnType<ProjectDeletionCurrentAssets['inspect']>>;
/** An explicit retain may preserve this proven foreign active Pod; it never grants its old birth or an exit. */
export function verifiedActiveForeignPod(target: ProjectDeletionTarget, raw: Record<string, unknown>, known: DirectoryService | undefined, current: Current): boolean {
  const pod = current.pods?.[0];
  if (!known || known.archived || known.projectId === target.id || raw['workload'] !== 'service' || !pod || current.pods?.length !== 1 || current.targetReferences.length) return false;
  if (known.namespace !== raw['namespace'] || known.projectSlug !== raw['project'] || known.serviceName !== raw['service'] || pod.namespace !== known.namespace || pod.name !== raw['pod_name'] || pod.uid !== raw['pod_uid']) return false;
  if (Object.values(pod.labels).some((value) => [target.id, target.serviceId, target.namespace, target.slug].includes(value))) return false;
  if (pod.phase !== 'Running' || pod.terminating || !pod.containersComplete || !pod.containers.length || pod.containers.some((c) => !c.id)) return false;
  if (![known.projectId, known.projectSlug].includes(pod.labels[LABELS.project] ?? '') || ![known.serviceId, known.serviceName].includes(pod.labels[LABELS.service] ?? '')) return false;
  return current.activeConsumers.length === 1 && current.activeConsumers[0] === `${pod.namespace}/${pod.name}@${pod.uid}`;
}

/** A reviewed current task/PVC baseline preserves a rebuilt foreign development consumer, without inventing its missing old UID. */
export function verifiedActiveForeignDevelopment(target: ProjectDeletionTarget, raw: Record<string, unknown>, known: DirectoryService | undefined, source: GatewayCurrentDevelopment | undefined): boolean {
  const pod = source?.assets.pods?.[0];
  if (!source || !known || known.archived || known.projectId === target.id || raw['workload'] !== 'dev-session' || raw['pod_uid'] !== null || raw['development_source'] !== null || raw['service_source'] !== null) return false;
  if (source.kind !== 'dev-session' || source.state !== 'running' || !source.originalAbsent || source.taskId !== raw['task_id'] || source.projectId !== known.projectId || source.serviceId !== known.serviceId) return false;
  if (source.namespace !== raw['namespace'] || known.namespace !== source.namespace || known.projectSlug !== raw['project'] || known.serviceName !== raw['service'] || source.podName === raw['pod_name']) return false;
  if (!source.assets.complete || source.assets.targetReferences.length || source.assets.pods?.length !== 1 || !pod || pod.namespace !== source.namespace || pod.name !== source.podName || pod.uid !== source.podUid) return false;
  if (pod.phase !== 'Running' || pod.terminating || !pod.containersComplete || !pod.containers.length || pod.containers.some(c => !c.id)) return false;
  if (pod.labels[LABELS.task] !== source.taskId || pod.labels[LABELS.workload] !== 'dev-session' || pod.labels['app.kubernetes.io/managed-by'] !== 'crewstation') return false;
  if (![known.projectId, known.projectSlug].includes(pod.labels[LABELS.project] ?? '') || ![known.serviceId, known.serviceName].includes(pod.labels[LABELS.service] ?? '')) return false;
  if (Object.values(pod.labels).some(value => [target.id, target.serviceId, target.namespace, target.slug].includes(value))) return false;
  if (!/^[a-f0-9]{64}$/.test(source.taskDigest) || !source.volumes.length || source.volumes.some(v => v.namespace !== source.namespace || !v.name || !v.uid || !v.pvName || !v.pvUid || !/^[a-f0-9]{64}$/.test(v.digest))) return false;
  return source.assets.activeConsumers.length === 1 && source.assets.activeConsumers[0] === `${pod.namespace}/${pod.name}@${pod.uid}`;
}
