import type { TaskId } from '@crewstation/contracts';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import type { RuntimeImageReferenceQuery, RuntimeImageReferenceState } from '../../ports/imageReferences';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';

/** Development history stays restorable until its parent is irreversibly released. */
export function runtimeImageReferenceState(deps: Pick<TaskRuntimeUseCaseDeps, 'uow' | 'cluster'>) {
  const physicallyReleased = async (env: TaskEnvironment): Promise<boolean> => {
    if (env.state !== 'released') return false;
    if (env.render) {
      const record = await deps.uow.read.ledger?.workload(env);
      if (!record || record.desired !== 'absent') return false;
    }
    return (await deps.cluster.podPhase(env)).phase === 'Missing';
  };
  return async (input: RuntimeImageReferenceQuery): Promise<RuntimeImageReferenceState> => {
    if (!['session', 'agent'].includes(input.ownerType)) return 'unknown';
    const env = await deps.uow.read.environments.getById(input.ownerId as TaskId);
    if (!env || env.kind !== 'dev-session' || env.projectId !== input.projectId || env.render?.runtimeImage?.versionId !== input.versionId) return 'unknown';
    if ((input.ownerType === 'agent') !== !!env.native) return 'unknown';
    if (env.native) {
      const parent = await deps.uow.read.environments.getById(env.native.parentTaskId);
      if (!parent || parent.kind !== 'dev-session' || parent.native || parent.projectId !== input.projectId) return 'unknown';
      if (!await physicallyReleased(parent)) return 'active';
    }
    return await physicallyReleased(env) ? 'released' : 'active';
  };
}
