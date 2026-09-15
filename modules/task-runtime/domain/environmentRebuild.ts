import type { DevSessionRebuildDto, ProjectId, RebuildDevSessionRequest, TaskId } from '@crewstation/contracts';

/** 恢复意图不携带凭据；新 Runner Secret 由集群适配器幂等准备。 */
export interface EnvironmentRebuild {
  readonly id: string;
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly input: RebuildDevSessionRequest;
  readonly namespace: string;
  readonly originalPodName: string;
  readonly podName: string;
  readonly pvcName: string;
  readonly secretName: string;
  readonly image: string;
  readonly nodeName?: string;
  readonly state: DevSessionRebuildDto['state'];
  readonly podUid?: string;
  readonly secretUid?: string;
  readonly message?: string;
  readonly failureReason?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function rebuildIsActive(record: EnvironmentRebuild): boolean {
  return ['queued', 'replacing', 'starting'].includes(record.state);
}

export function rebuildToDto(record: EnvironmentRebuild): DevSessionRebuildDto {
  return { requestId: record.id, taskId: record.taskId, state: record.state, profile: record.input.profile,
    createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(), ...(record.message ? { message: record.message } : {}) };
}
