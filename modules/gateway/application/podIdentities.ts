import type { WorkloadIdentity } from '@crewstation/contracts';
import type { PodLabels } from '../domain/podIdentity';
import { identityFromLabels, toWorkloadIdentity } from '../domain/podIdentity';
import type { GatewayUseCaseDeps } from './dependencies';

export interface ObservedPod {
  name: string;
  namespace: string;
  ip?: string;
  labels: PodLabels;
  deleted: boolean;
  phase?: string;
}

/** Pod 身份索引：watch 增量维护，cs-auth 按源 IP 反查（G1）。 */
export function podIdentityUseCases(deps: GatewayUseCaseDeps) {
  return {
    syncPod: async (pod: ObservedPod): Promise<void> => {
      const identity = identityFromLabels(pod.labels);
      if (!identity) return;
      if (identity.taskId && deps.normalizeTaskId) {
        const taskId = await deps.normalizeTaskId(identity.taskId);
        if (!taskId) return;
        identity.taskId = taskId;
      }
      const now = deps.clock.now();
      if (pod.deleted || !pod.ip || pod.phase === 'Succeeded' || pod.phase === 'Failed') {
        await deps.pods.markDeleted(pod.name, pod.namespace, now);
        return;
      }
      await deps.pods.upsert({ ip: pod.ip, podName: pod.name, namespace: pod.namespace, ...identity, updatedAt: now });
    },
    lookupByIp: async (ip: string): Promise<WorkloadIdentity | undefined> => {
      const record = await deps.pods.byIp(ip);
      if (!record || record.deletedAt) return undefined;
      let prodPhysical: string | undefined;
      if (record.workload === 'service' && record.physicalSlot) {
        const svc = (await deps.services.listServices()).find((s) => s.identity === `${record.project}/${record.service}`);
        prodPhysical = svc ? (await deps.slots.slotRoles(svc.serviceId))?.prod : undefined;
      }
      return toWorkloadIdentity(record, prodPhysical);
    },
    listPodIdentities: () => deps.pods.listActive(),
  };
}
