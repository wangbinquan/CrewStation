import type { DevelopmentUsageLayoutLookup, TaskId } from '@crewstation/contracts';
import { TaskIdSchema } from '@crewstation/contracts';
import { developmentUsageLayoutSnapshot } from '../../domain/developmentUsageLayout';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';

/** This module's actual SQL row only; no Runner, cluster, owner or current profile lookup. */
export function developmentUsageLayoutLookup(deps: Pick<TaskRuntimeUseCaseDeps, 'uow'>) {
  return async (rawTaskId: TaskId): Promise<DevelopmentUsageLayoutLookup> => {
    const taskId = TaskIdSchema.parse(rawTaskId);
    const row = await deps.uow.read.environments.getById(taskId);
    return developmentUsageLayoutSnapshot(taskId, row);
  };
}
