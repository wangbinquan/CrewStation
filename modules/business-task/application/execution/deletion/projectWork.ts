import type { TaskId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { BusinessWorkInput } from '../../../domain/deletion/work';
import type { BusinessProjectWork } from '../../../ports/deletion/work';
import type { BusinessExecutionDeps } from '../dependencies';

/** Copies narrow asynchronous ports; the shared Runner/TaskRuntime instances remain unchanged for other owners. */
export function guardedBusinessPort<T extends object>(port: T, work: BusinessProjectWork, optional = false, methods: readonly string[] = []): T {
  const copy = Object.assign({}, port);
  for (const name of new Set([...Object.keys(port), ...methods])) Object.defineProperty(copy, name, { enumerable: true,
    get: () => typeof Reflect.get(port, name) !== 'function' ? Reflect.get(port, name) : (...args: unknown[]) =>
      (optional ? work.whenActive : work.effect)(() => Reflect.apply(Reflect.get(port, name) as (...args: unknown[]) => Promise<unknown>, port, args)),
  });
  return copy;
}
export function scopedBusinessPorts<T extends BusinessExecutionDeps>(deps: T, optional = false): T {
  const work = deps.projectWork; if (!work) return deps;
  return { ...deps, environments: guardedBusinessPort(deps.environments, work, optional, ['restartBusinessWorkspace', 'rebuildBusinessWorkspace', 'inspectBusinessRecovery', 'blockBusinessAdmission']),
    runner: guardedBusinessPort(deps.runner, work, optional, ['getExecutionCompletionProof', 'consumeBusinessExecution', 'getBusinessExecution', 'listBusinessExecutionEvents']),
    compute: guardedBusinessPort(deps.compute, work, optional, ['pinLaunchVersion', 'launchMaterialAt']),
    ...(deps.runtimeImages ? { runtimeImages: guardedBusinessPort(deps.runtimeImages, work, optional) } : {}),
    ...(deps.taskInputs ? { taskInputs: guardedBusinessPort(deps.taskInputs, work, optional) } : {}),
    ...(deps.agentSecrets ? { agentSecrets: guardedBusinessPort(deps.agentSecrets, work, optional) } : {}),
    ...(deps.executionObservations ? { executionObservations: guardedBusinessPort(deps.executionObservations, work, optional) } : {}),
  };
}
export async function businessExecutionWork<T>(deps: BusinessExecutionDeps, input: {
  serviceId: string; taskId: TaskId; kind: BusinessWorkInput['kind']; reference: string; revision: unknown;
}, callback: (scoped: BusinessExecutionDeps) => Promise<T>): Promise<T> {
  const work = deps.projectWork; if (!work) return callback(deps);
  const parent = await deps.operations.forTask(input.serviceId, input.taskId);
  if (!parent || parent.serviceId !== input.serviceId || parent.intent.task.serviceId !== input.serviceId || parent.intent.task.id !== input.taskId)
    throw precondition('业务执行回调缺少同一原项目／服务的受理任务根');
  return work.run({ projectId: parent.intent.projectId, serviceId: input.serviceId, kind: input.kind, reference: input.reference,
    inputDigest: jsonHash(input) }, () => callback(scopedBusinessPorts(deps)));
}
