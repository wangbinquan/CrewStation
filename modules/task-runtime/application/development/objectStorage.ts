import type { DevelopmentSourceBinding } from '@crewstation/contracts';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import type { TaskEnvironment } from '../../domain/taskEnvironment';

/** Identity already checks the current Pod UID; runtime checks its live admission and parent. */
export function resolveDevelopmentObjectSource(deps: Pick<TaskRuntimeUseCaseDeps, 'uow'>) {
  return (source: DevelopmentSourceBinding) => deps.uow.run(async ({ environments }) => {
    const env = await environments.getById(source.taskId);
    if (!source.ready || !available(env) || env.podName !== source.podName || (env.native?.podUid ?? env.podUid) !== source.podUid) return undefined;
    if (env.native) {
      const parent = await environments.getById(env.native.parentTaskId);
      if (env.native.state !== 'running' || !available(parent) || parent.native || parent.podUid !== env.native.parentPodUid || parent.podName !== env.render?.execution?.workspacePod
        || parent.serviceId !== env.serviceId || parent.projectId !== env.projectId || parent.render?.developmentObjectPlanId !== env.render?.developmentObjectPlanId) return undefined;
    }
    return { projectId: env.projectId, serviceId: env.serviceId, planId: env.render!.developmentObjectPlanId! };
  });
}

function available(env: TaskEnvironment | undefined): env is TaskEnvironment {
  return !!env && env.kind === 'dev-session' && env.state === 'running' && env.connected && !!env.render?.developmentObjectPlanId;
}
