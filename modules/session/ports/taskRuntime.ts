import type { Actor, TaskId } from '@crewstation/contracts';

/** 由 task-runtime 模块提供：校验 TaskRunner 的一次性令牌，判定谁能打开某任务的流。 */
export interface RunnerAuth {
  verifyRunnerToken(taskId: TaskId, token: string): Promise<{ ok: true; projectId: string } | { ok: false; reason: string }>;
}

export interface TaskAccess {
  /** 开发会话的成员、业务任务所属服务的成员；管理员放行。 */
  canOpenStream(actor: Actor, taskId: TaskId): Promise<boolean>;
  /** 连接建立与断开的回调，task-runtime 据此维护环境状态与空闲计时。 */
  onRunnerConnected(taskId: TaskId, token: string): Promise<boolean | void>;
  onRunnerDisconnected(taskId: TaskId, token: string): Promise<void>;
  /** 握手因协议不一致被拒（RFC-006）：task-runtime 把原因记在环境上，不改状态、不删 Pod。 */
  onRunnerRejected?(taskId: TaskId, token: string, rejection: { code: 'protocol_mismatch'; runnerProtocol: number | null; message: string }): Promise<void>;
  /** 本地连接及注册表准备好之后才可派发任务；调用方不能等待 Runner 回执。 */
  onRunnerReady?(taskId: TaskId): void;
}
