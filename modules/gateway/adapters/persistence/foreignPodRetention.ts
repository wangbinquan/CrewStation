import type { ProjectDeletionCurrentAssets, ProjectDeletionTarget } from '@crewstation/contracts';
import { LABELS } from '@crewstation/k8s';
import type { DirectoryService } from '../../ports/directories';

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
