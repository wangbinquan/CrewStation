import type { BusinessReleaseMaterials } from '@crewstation/contracts';
import type { BusinessTaskV3Dto, ProjectId, TasksSpec } from '@crewstation/contracts';

/** 受理前固定的非敏感材料；恢复不能重新读 latest release 或默认套餐。 */
export interface TaskAdmissionIntent {
  readonly restartOf?: { readonly taskId: BusinessTaskV3Dto['id']; readonly expectedGeneration: number };
  readonly kind: 'create-task';
  readonly projectId: ProjectId;
  readonly callerIdentity: string;
  readonly task: BusinessTaskV3Dto;
  readonly tasksSpec: TasksSpec;
  readonly releaseMaterials?: BusinessReleaseMaterials;
  readonly environmentLabels: Record<string, string>;
}

export type ExecutionOperationState = 'pending' | 'running' | 'succeeded' | 'failed' | 'retryable-rejected';

/** operation 与其派发意图是同一持久记录，不存在写完业务记录却忘记入队的窗口。 */
export interface ExecutionOperation {
  readonly id: string;
  readonly serviceId: string;
  readonly kind: TaskAdmissionIntent['kind'];
  readonly parentId: string;
  readonly requestKey: string;
  /** 用户参数摘要不含 trace／fence；release 的默认值保存在 intent 和 effectiveDigest。 */
  readonly requestDigest: string;
  readonly effectiveDigest: string;
  readonly intent: TaskAdmissionIntent;
  readonly epoch: number | null;
  readonly state: ExecutionOperationState;
  readonly revision: number;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lease: { readonly owner: string; readonly until: string } | null;
  readonly errorCode: string | null;
}

export type OperationKey = Pick<ExecutionOperation, 'serviceId' | 'kind' | 'parentId' | 'requestKey'>;
export type OperationCandidate = Pick<ExecutionOperation, 'id' | 'serviceId' | 'kind' | 'parentId' | 'requestKey' | 'requestDigest' | 'effectiveDigest' | 'intent' | 'epoch'>;
export interface OperationLease { readonly id: string; readonly owner: string; readonly revision: number }
