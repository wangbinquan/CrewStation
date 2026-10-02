import { jsonHash } from '@crewstation/kernel';
import { hasDevelopmentParentEnding } from '../../domain/development/parentEnding';
import { completeStage, failStartup } from '../../domain/podStartup';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import { transition } from '../../domain/taskEnvironment';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';

function identity(env: TaskEnvironment): string {
  const render = env.render;
  const accepted = render ? Object.fromEntries(Object.entries(render).filter(([key]) => !['runtimeConnectionDeadline', 'runtimeInitializationDeadline'].includes(key))) : null;
  return jsonHash({ id: env.id, projectId: env.projectId, serviceId: env.serviceId, kind: env.kind,
    volumeMode: env.volumeMode, namespace: env.namespace, podName: env.podName, pvcName: env.pvcName,
    profile: env.profile, labels: env.labels, runnerTokenHash: env.runnerTokenHash, rebuildId: env.rebuildId ?? null, render: accepted });
}

/** Re-read raw SQL presence under the original Project lock; late results never replace a newer creation. */
async function applyResult(deps: TaskRuntimeUseCaseDeps, original: TaskEnvironment,
  result: { kind: 'ack'; uid: string } | { kind: 'failure'; message: string }): Promise<void> {
  try {
    await deps.uow.run(async (scope) => {
      await scope.admissions.lock(original.projectId);
      const view = await scope.environments.getMaintenanceView?.(original.id);
      if (view?.status !== 'present') return;
      const current = view.environment;
      if (identity(current) !== identity(original) || current.kind === 'dev-session' && hasDevelopmentParentEnding(current)) return;
      const at = deps.clock.now();
      if (result.kind === 'ack') {
        if (!['creating', 'running'].includes(current.state) || current.podUid !== original.podUid && current.podUid !== result.uid) return;
        const updated = { ...current, podUid: result.uid,
          ...(current.startup ? { startup: completeStage(current.startup, 'queue', at.toISOString()) } : {}) };
        if (jsonHash(updated) !== jsonHash(current)) await scope.environments.update(updated);
        return;
      }
      if (current.state !== 'creating' || current.connected || current.podUid !== original.podUid) return;
      await scope.environments.update(transition(current, 'failed', at, { message: result.message,
        ...(current.startup ? { startup: failStartup(current.startup, at.toISOString(), { code: 'pod-create-failed', message: result.message }) } : {}) }));
      await scope.quota.release(current);
    });
  } catch {
    // The transaction rolls back; preserve the original cluster error instead of masking it with a secondary failure.
    deps.logger.warn('task initial pod result persistence failed', { taskId: original.id });
  }
}

export async function recordInitialPodAck(deps: TaskRuntimeUseCaseDeps, original: TaskEnvironment, uid: string | void): Promise<void> {
  if (typeof uid !== 'string' || uid.trim().length === 0) return;
  await applyResult(deps, original, { kind: 'ack', uid });
}
export async function recordInitialPodFailure(deps: TaskRuntimeUseCaseDeps, original: TaskEnvironment, message: string): Promise<void> {
  await applyResult(deps, original, { kind: 'failure', message });
}
