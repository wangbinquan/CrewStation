import type { ProjectId, TaskId } from '@crewstation/contracts';

/**
 * 由 task-runtime 经装配注入：令牌里的任务此刻是否仍是一个运行中的开发会话。
 * 这是“随会话释放失效”的执行点——释放把环境置为 releasing／released，下一次校验就查不到，
 * 令牌立刻作废，不必等过期，也不需要另存一张吊销表。
 * 缺省实现返回 undefined：没装配就等于全部拒绝。
 */
export interface DevSessionState {
  activeSession(taskId: TaskId): Promise<{ projectId: ProjectId } | undefined>;
}
