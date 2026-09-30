import type { DevelopmentUsageLayoutLookup, TaskId } from '@crewstation/contracts';
import { DevelopmentUsageLayoutLookupSchema, DevelopmentUsageStorageSchema } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { TaskEnvironment } from './taskEnvironment';

/** A persisted layout snapshot, never a physical-stop, zero-usage or cleanup proof. */
export function developmentUsageLayoutSnapshot(executionTaskId: TaskId, env?: TaskEnvironment): DevelopmentUsageLayoutLookup {
  if (!env) return DevelopmentUsageLayoutLookupSchema.parse({ version: 1, executionTaskId, kind: 'absent' });
  if (env.id !== executionTaskId) throw precondition('Development layout lookup returned another execution');
  const layout = env.render?.developmentUsageStorage;
  if (layout === undefined) return DevelopmentUsageLayoutLookupSchema.parse({ version: 1, executionTaskId, kind: 'legacy' });
  const parsed = DevelopmentUsageStorageSchema.safeParse(layout), native = env.native;
  if (!parsed.success || env.kind !== 'dev-session' || native?.purpose !== 'agent' || native.terminalId !== undefined || !native.computeProfile)
    throw precondition('Selected development layout requires the original independent Agent and compute revision');
  if (env.podUid !== undefined && native.podUid !== undefined && env.podUid !== native.podUid)
    throw precondition('Selected development layout has conflicting original Pod instances');
  return DevelopmentUsageLayoutLookupSchema.parse({
    version: 1, executionTaskId, kind: 'selected', layout: parsed.data,
    projectId: env.projectId, workspaceTaskId: native.parentTaskId, agentId: native.agentId,
    profileId: native.computeProfile.profileId, profileRevision: native.computeProfile.revision,
    namespace: env.namespace, podName: env.podName, podUid: env.podUid ?? native.podUid ?? null,
    state: env.state, nativeState: native.state, renderStart: env.render!.start, revision: env.updatedAt.toISOString(),
  });
}
