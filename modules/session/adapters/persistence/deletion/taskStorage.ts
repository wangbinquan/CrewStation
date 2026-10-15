import { TaskIdSchema } from '@crewstation/contracts';
import type { TaskId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { SessionOriginalTaskStorage } from '../../../ports/projectDeletion';

export function sessionStorageKey(taskId: string, storage?: SessionOriginalTaskStorage): string {
  if (storage && taskId !== storage.taskId) throw precondition('私有数字存储键不属于原规范任务');
  return storage?.taskKey ?? taskId;
}
export function sessionStoredTaskId(taskKey: string, storage?: SessionOriginalTaskStorage): TaskId {
  if (storage && taskKey !== storage.taskKey) throw precondition('原数字行不属于已核实的存储键');
  return TaskIdSchema.parse(storage?.taskId ?? taskKey);
}
