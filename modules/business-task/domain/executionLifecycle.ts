import type { BusinessOperationDto, BusinessTaskStateV3, RuntimeImageExecutionSnapshot, RuntimeImageSelection, TaskId } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';

export type LifecycleAction = 'pause' | 'resume' | 'close' | 'rebuild' | 'upgrade-runtime-image';
/** RFC-043: the upgrade target fixed at admission; `fromVersionId` is the pin it replaces. */
export interface RuntimeImageUpgradePayload {
  readonly kind: 'runtime-image'; readonly targetVersionId: string; readonly requestedVersionId: string | null;
  readonly selection: RuntimeImageSelection; readonly fromVersionId: string;
}
export interface ExecutionLifecycle {
  id: string; serviceId: string; taskId: TaskId; action: LifecycleAction; requestKey: string;
  expectedGeneration: number; generation: number; priorState: BusinessTaskStateV3;
  state: BusinessOperationDto['state']; epoch: number | null; dispatched: boolean;
  revision: number; owner: string | null; errorCode: string | null; payload: RuntimeImageUpgradePayload | null;
}
/** `runtimeImage` is present only once an upgrade repinned the task away from its admission snapshot. */
export interface ExecutionTaskState { generation: number; state: BusinessTaskStateV3; operationId: string | null; runtimeImage?: RuntimeImageExecutionSnapshot | null }
export const lifecycleView = (operation: ExecutionLifecycle): BusinessOperationDto => ({ operationId: operation.id, taskId: operation.taskId, state: operation.state, ...(operation.errorCode ? { message: operation.errorCode } : {}) });

/** Every image reader uses the current pin: an upgrade's snapshot, else the immutable admission snapshot. */
export function currentTaskRuntimeImage(admitted: RuntimeImageExecutionSnapshot | undefined, state: Pick<ExecutionTaskState, 'runtimeImage'> | undefined): RuntimeImageExecutionSnapshot | undefined {
  return state?.runtimeImage ?? admitted;
}
/** Recovery material changes with the pin, so an assessment made before an upgrade no longer matches. */
export function taskMaterialDigest(effectiveDigest: string, state: Pick<ExecutionTaskState, 'runtimeImage'> | undefined): string {
  return state?.runtimeImage ? jsonHash({ admission: effectiveDigest, runtimeImageVersionId: state.runtimeImage.versionId }) : effectiveDigest;
}
