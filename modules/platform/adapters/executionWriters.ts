import type { ReleaseId, ServiceId } from '@crewstation/contracts';
import type { K8sClient } from '@crewstation/k8s';
import { LABELS, Resources } from '@crewstation/k8s';

/** A deletion request or missing runtime row is not proof. Observe the actual project Pods. */
export function executionWriterObserver(k8s: K8sClient, service: (id: ServiceId) => Promise<{ namespace: string; name: string } | undefined>) {
  return async (id: ServiceId, includeServices = false): Promise<boolean> => {
    const resolved = await service(id); if (!resolved) return false;
    const pods = await k8s.list(Resources.Pod!, resolved.namespace, { labelSelector: `${LABELS.service}=${resolved.name},${LABELS.workload} in (${includeServices ? 'business-task,service' : 'business-task'})` });
    // Even Succeeded/Failed may still have sidecars; absence is the only universally valid proof.
    return pods.length === 0;
  };
}

/** Release supplies a durable Finished observation; a lingering Pod still blocks supersession. */
export function migrationWriterObserver(k8s: K8sClient, service: (id: ServiceId) => Promise<{ namespace: string } | undefined>) {
  return async (id: ServiceId, releaseId: ReleaseId, requireSuspendedJob = false): Promise<boolean> => {
    const resolved = await service(id); if (!resolved) return false;
    if (requireSuspendedJob) {
      const jobs = await k8s.list(Resources.Job!, resolved.namespace, { labelSelector: `${LABELS.release}=${releaseId},${LABELS.component}=migration` });
      if (jobs.length !== 1 || jobs[0]!.metadata.deletionTimestamp || (jobs[0]!.spec as { suspend?: boolean }).suspend !== true
        || !(jobs[0]!.status as { conditions?: Array<{ type: string; status: string }> })?.conditions?.some((c) => c.type === 'Suspended' && c.status === 'True')) return false;
    }
    const pods = await k8s.list(Resources.Pod!, resolved.namespace, { labelSelector: `${LABELS.release}=${releaseId}` });
    return pods.length === 0;
  };
}

/** Never compare Pod names: a replacement can reuse a name while the old process is gone. */
export function legacyOwnerObserver(k8s: K8sClient, namespace: string) {
  return { ownerGone: async (uid: string): Promise<boolean> => {
    if (!uid) return false;
    const pods = await k8s.list(Resources.Pod!, namespace);
    return !pods.some((pod) => pod.metadata?.uid === uid);
  } };
}
