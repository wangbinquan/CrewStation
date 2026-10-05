import type { Database } from '@crewstation/persistence';
import { drizzleBusinessExecutionStore } from '../businessExecutions';
import { drizzleBusinessUsageSourceStore } from '../businessUsageSources';
import { drizzleDevelopmentUsageStore } from '../developmentUsage';
import { drizzleDevelopmentUsageSourceStore } from '../developmentUsageSources';
import type { SessionCleanupCopySelector } from '../../../ports/originalTaskData';
import { originalSessionTaskStorage, readOriginalSessionTasks } from './scopeTasks';

export function originalSessionCopies(db: Database): SessionCleanupCopySelector {
  return async (context, scope, taskId) => {
    await readOriginalSessionTasks(db, context.target.id, scope, null);
    const storage = await originalSessionTaskStorage(db, context.target.id, scope, taskId);
    return { taskKey: storage.taskKey, copies: {
      business: drizzleBusinessExecutionStore(db, storage), businessSources: drizzleBusinessUsageSourceStore(db, storage),
      development: drizzleDevelopmentUsageStore(db, storage), developmentSources: drizzleDevelopmentUsageSourceStore(db, storage),
    } };
  };
}
