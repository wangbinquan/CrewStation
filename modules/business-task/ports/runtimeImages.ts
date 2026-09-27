import type { ProjectId, RuntimeImageExecutionSnapshot, RuntimeImageSelection, TaskId } from '@crewstation/contracts';

/** 服务身份已经过来源 Pod 及 release 校验，只能采用所属 release 的允许集合。 */
export interface BusinessRuntimeImages {
  release?(snapshot: RuntimeImageExecutionSnapshot, owner: { type: 'task' | 'agent'; id: TaskId }): Promise<void>;
  reserveAgent?(projectId: ProjectId, taskId: TaskId, selection: RuntimeImageSelection, profile: { profileId: string; revision: number }, requestedVersionId?: string): Promise<RuntimeImageExecutionSnapshot | undefined>;
  confirmAgent?(snapshot: RuntimeImageExecutionSnapshot, taskId: TaskId): Promise<void>;
  restoreAgent?(projectId: ProjectId, snapshot: RuntimeImageExecutionSnapshot, from: TaskId, to: TaskId): Promise<void>;
  reserveTask(projectId: ProjectId, taskId: TaskId, selection: RuntimeImageSelection, requestedVersionId?: string): Promise<RuntimeImageExecutionSnapshot | undefined>;
  confirmTask(snapshot: RuntimeImageExecutionSnapshot, taskId: TaskId): Promise<void>;
}
