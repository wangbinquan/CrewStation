import type { ResourceIdentityDirectory } from '@crewstation/persistence';

/** An alias for the same task, never a new resource identity or an application lookup key. */
export function legacyRunnerTaskId(directory: ResourceIdentityDirectory) {
  return async (taskId: string): Promise<string> => {
    const alias = `tsk_${taskId.replaceAll('-', '')}`;
    await directory.bind('task_runtime', 'task', [alias], taskId);
    return alias;
  };
}
