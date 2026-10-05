import { TaskIdSchema } from '@crewstation/contracts';
import type { TaskId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { SessionOriginalTaskStorage } from '../../../ports/projectDeletion';
import type { developmentUsageStreams } from '../developmentUsageTables';

export function sessionStorageKey(taskId: string, storage?: SessionOriginalTaskStorage): string {
  if (storage && taskId !== storage.taskId) throw precondition('私有数字存储键不属于原规范任务');
  return storage?.taskKey ?? taskId;
}
export function sessionStoredTaskId(taskKey: string, storage?: SessionOriginalTaskStorage): TaskId {
  if (storage && taskKey !== storage.taskKey) throw precondition('原数字行不属于已核实的存储键');
  return TaskIdSchema.parse(storage?.taskId ?? taskKey);
}

/** Translate only the verified task field at the boundary; persisted source JSON stays byte-for-byte intact. */
export function originalDevelopmentRow(row: typeof developmentUsageStreams.$inferSelect, storage?: SessionOriginalTaskStorage): typeof developmentUsageStreams.$inferSelect {
  if (!storage) return row;
  const taskId = sessionStoredTaskId(row.taskId, storage);
  const originalId = (value: string) => {
    if (value !== storage.taskKey && value !== taskId) throw precondition('旧开发数字登记含另一任务身份，不能改绑');
    return taskId;
  };
  const key = <T extends { executionId: string }>(value: T): T => ({ ...value, executionId: originalId(value.executionId) });
  const registration = { ...row.registration, runtimeTaskId: originalId(row.registration.runtimeTaskId),
    key: key(row.registration.key), identity: key(row.registration.identity) };
  return { ...row, registration,
    receipt: row.receipt && { ...row.receipt, key: key(row.receipt.key), identity: key(row.receipt.identity) },
    loss: row.loss && { ...row.loss, key: key(row.loss.key) } };
}
