import { precondition } from '@crewstation/kernel';
import type { TaskEnvironment } from '../../domain/taskEnvironment';

export function assertBusinessStorageMutable(env: TaskEnvironment): void {
  if (env.render?.storageFinalization) throw precondition('任务已进入归档终结，不能重新启动', { code: 'task_finalizing' });
}
