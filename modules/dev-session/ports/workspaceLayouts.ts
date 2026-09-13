import type { TaskId, UserId, WorkspaceLayout, WorkspaceLayoutDto } from '@crewstation/contracts';

export interface WorkspaceLayouts {
  get(taskId: TaskId, userId: UserId): Promise<WorkspaceLayoutDto | undefined>;
  /** 原子 revision 检查；冲突不写入，返回 undefined。 */
  save(taskId: TaskId, userId: UserId, expectedRevision: number, layout: WorkspaceLayout): Promise<WorkspaceLayoutDto | undefined>;
}
