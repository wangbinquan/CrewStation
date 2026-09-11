import type { Actor, TaskId } from '@crewstation/contracts';

/** 由 task-runtime 模块提供：校验 TaskRunner 的一次性令牌，判定谁能打开某任务的流。 */
export interface RunnerAuth {
  verifyRunnerToken(taskId: TaskId, token: string): Promise<{ ok: true; projectId: string } | { ok: false; reason: string }>;
}

export interface TaskAccess {
  /** 开发会话的成员、业务任务所属服务的成员；管理员放行。 */
  canOpenStream(actor: Actor, taskId: TaskId): Promise<boolean>;
  /** 连接建立与断开的回调，task-runtime 据此维护环境状态与空闲计时。 */
  onRunnerConnected(taskId: TaskId): Promise<void>;
  onRunnerDisconnected(taskId: TaskId): Promise<void>;
}
