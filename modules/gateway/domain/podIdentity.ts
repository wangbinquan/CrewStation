import type { WorkloadIdentity, WorkloadKind } from '@crewstation/contracts';

/** 从 Pod 标签还原工作负载身份；标签名与 packages/k8s 的 LABELS 一致，但领域层不依赖 k8s 包。 */
export interface PodLabels {
  'crewstation.io/project'?: string;
  'crewstation.io/service'?: string;
  'crewstation.io/slot'?: string;
  'crewstation.io/workload'?: string;
  'crewstation.io/task'?: string;
  'app.kubernetes.io/managed-by'?: string;
}

export interface PodIdentityRecord {
  ip: string;
  podName: string;
  namespace: string;
  project: string;
  service: string;
  workload: WorkloadKind;
  physicalSlot?: string;
  taskId?: string;
  version: number;
  updatedAt: Date;
  deletedAt?: Date;
}

const WORKLOADS: readonly WorkloadKind[] = ['service', 'dev-session', 'business-task', 'platform'];

/** 身份索引的墓碑（Pod 已不在的行）保留多久（RFC-025 提案 Q5：7 天）；按 IP 反查与在册清单都不读墓碑，过期即删。 */
export const TOMBSTONE_RETENTION_MS = 7 * 24 * 3_600_000;

export function identityFromLabels(labels: PodLabels): { project: string; service: string; workload: WorkloadKind; physicalSlot?: string; taskId?: string } | undefined {
  if (labels['app.kubernetes.io/managed-by'] !== 'crewstation') return undefined;
  const project = labels['crewstation.io/project'];
  const service = labels['crewstation.io/service'];
  const workload = labels['crewstation.io/workload'] as WorkloadKind | undefined;
  if (!project || !service || !workload || !WORKLOADS.includes(workload)) return undefined;
  return { project, service, workload, ...(labels['crewstation.io/slot'] ? { physicalSlot: labels['crewstation.io/slot'] } : {}), ...(labels['crewstation.io/task'] ? { taskId: labels['crewstation.io/task'] } : {}) };
}

/** 物理槽名转成协议里的角色；由调用方给出当前 prod 物理槽。 */
export function toWorkloadIdentity(record: PodIdentityRecord, prodPhysical: string | undefined): WorkloadIdentity {
  const slot = record.physicalSlot ? (record.physicalSlot === prodPhysical ? 'prod' : 'preview') : undefined;
  return {
    identity: `${record.project}/${record.service}`,
    project: record.project,
    service: record.service,
    kind: record.workload,
    ...(slot ? { slot } : {}),
    ...(record.taskId ? { taskId: record.taskId as WorkloadIdentity['taskId'] } : {}),
  };
}
