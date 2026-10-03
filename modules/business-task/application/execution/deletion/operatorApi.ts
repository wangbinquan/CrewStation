import type { Actor, TaskId } from '@crewstation/contracts';
import { forbidden, notFound } from '@crewstation/kernel';
import type { BusinessStorageOperatorApi } from '../../../api/storageOperator';
import type { BusinessTaskRecoveryApi } from '../../../api/taskRecovery';
import type { RecoveryQueries } from '../../../ports/taskRecovery';
import type { ProjectAuthorizer } from '../../../ports/runtime';
import type { BusinessExecutionDeps } from '../dependencies';
import { businessExecutionWork } from './projectWork';

type OperatorApi = BusinessStorageOperatorApi & BusinessTaskRecoveryApi;
const mutations = ['deleteStorageArtifacts', 'confirmStorageLoss', 'prepareStorageArchive', 'finalizeStorageAsOperator', 'reviseStorageAsOperator', 'requestTaskRecovery'] as const satisfies readonly (keyof OperatorApi)[];

/** Authorize the original accepted task before registering an administrative callback. */
export function scopedBusinessOperatorApi(api: OperatorApi, deps: BusinessExecutionDeps & { authorizer: ProjectAuthorizer }, queries: RecoveryQueries): OperatorApi {
  if (!deps.projectWork) return api;
  const guarded = Object.fromEntries(mutations.map((name) => [name, async (actor: Actor, taskId: TaskId, ...args: unknown[]) => {
    if (name === 'requestTaskRecovery' && !actor.isAdmin) throw forbidden('业务执行恢复仅供平台管理员');
    const parent = await queries.task(taskId); if (!parent) throw notFound('业务任务', taskId);
    if (name !== 'requestTaskRecovery') await deps.authorizer.authorize(actor, parent.intent.projectId, 'manage-task-storage');
    return businessExecutionWork(deps, { serviceId: parent.serviceId, taskId, kind: 'service-api', reference: taskId, revision: { name, args } },
      () => Reflect.apply(api[name], api, [actor, taskId, ...args]) as Promise<unknown>);
  }]));
  return { ...api, ...guarded };
}
