import type { TaskMaintenanceRegistry, TaskMaintenanceRuntime } from '../../ports/taskMaintenance';

/** Register the actual owner before starting maintenance, preserving the same runtime API. */
export function bindTaskMaintenance<T extends TaskMaintenanceRuntime>(resources: TaskMaintenanceRegistry, runtime: T): T {
  resources.registerMaintenanceEndingHandler('task-runtime', (step, snapshot) => runtime.inspectResourceEnding?.(step, snapshot)
    ?? Promise.resolve({ status: 'waiting', reason: 'task-ending-handler-unavailable' }));
  return runtime;
}
