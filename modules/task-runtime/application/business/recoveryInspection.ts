import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { BusinessRecoveryScope, BusinessWorkspaceProof } from '../../api/businessRecovery';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import { storageStopProved } from './storageStop';

/** Inspect the original namespace and instances without renewing, reconciling or creating anything. */
export function inspectBusinessRecovery(deps: TaskRuntimeUseCaseDeps) {
  return async (scope: BusinessRecoveryScope): Promise<BusinessWorkspaceProof | undefined> => {
    const env = await deps.uow.read.environments.getById(scope.taskId);
    if (!env || env.projectId !== scope.projectId || env.serviceId !== scope.serviceId || env.kind !== 'business' || env.native) return undefined;
    if (!deps.businessStorageInspector) throw precondition('业务执行资源检查不可用', { code: 'resource_observation_unavailable' });
    const inspector = deps.businessStorageInspector;
    const { pod, volume } = await inspector.inspect(env);
    const children = await deps.uow.read.environments.listChildren(env.id);
    let activeChildren = false;
    for (const child of children) {
      // Even a terminal journal cannot prove that a lingering or replaced physical Pod disappeared.
      if (child.native?.state !== 'finished' || (await inspector.inspect(child)).pod !== null || !await storageStopProved(deps, child)) { activeChildren = true; break; }
    }
    const latest = await deps.uow.read.environments.getById(env.id);
    if (!latest || jsonHash(latest) !== jsonHash(env)) throw conflict('资源检查期间工作区已变化，请重新检查', { code: 'workspace_changed' });
    const persistent = env.volumeMode === 'persistent' && Boolean(env.render?.businessStorage);
    const volumeUid = env.businessWorkspace?.volumeUid ?? null;
    return {
      state: env.state, persistent, stopped: pod === null && !env.connected && await storageStopProved(deps, env), activeChildren, volumeUid,
      volumeVerified: Boolean(persistent && volumeUid && volume && volume.uid === volumeUid && volume.phase === 'Bound' && volume.belongsToTask && !volume.deleting),
      image: env.render?.image, runtimeImage: env.render?.runtimeImage,
    };
  };
}
