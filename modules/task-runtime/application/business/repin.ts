import { ResourceIdSchema, RuntimeImageExecutionSnapshotSchema } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { RepinBusinessWorkspaceInput } from '../../api/businessRecovery';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import { assertBusinessStorageMutable } from './finalizationGuard';
import { inspectBusinessWorkspace } from './workspace';
import { storageStopProved } from './storageStop';

/**
 * RFC-043: swap the runtime image of a paused durable business workspace. Identity, volume and start count stay as they are;
 * resume copies the render as usual, so the next Pod runs the new image over the retained volume and its initializer runs again.
 */
export function repinPausedBusinessWorkspace(deps: TaskRuntimeUseCaseDeps) {
  return async (input: RepinBusinessWorkspaceInput): Promise<TaskEnvironment> => {
    ResourceIdSchema.parse(input.operationId);
    if (!Number.isSafeInteger(input.generation) || input.generation < 1) throw precondition('升级世代无效');
    const image = RuntimeImageExecutionSnapshotSchema.parse(input.runtimeImage);
    const original = await deps.uow.read.environments.getById(input.taskId);
    if (!original || original.projectId !== input.projectId || original.serviceId !== input.serviceId || original.kind !== 'business' || original.native) throw precondition('业务工作区不存在', { code: 'workspace_missing' });
    assertBusinessStorageMutable(original);
    if (replayed(original, input)) return original;
    assertPaused(original);
    await inspectBusinessWorkspace(deps, original);
    if ((await deps.cluster.podPhase(original)).phase !== 'Missing') throw precondition('原 Pod 尚未确认删除', { code: 'workspace_cleanup_pending' });
    if (!await storageStopProved(deps, original)) throw precondition('原消费者尚未取得停止证明', { code: 'workspace_cleanup_pending' });
    return deps.uow.run(async (scope) => {
      await scope.admissions.lock(original.projectId);
      const current = await scope.environments.getById(original.id);
      if (!current) throw precondition('业务工作区不存在', { code: 'workspace_missing' });
      assertBusinessStorageMutable(current);
      if (replayed(current, input)) return current;
      if (jsonHash(current) !== jsonHash(original)) throw conflict('检查后工作区已变化，请重新升级', { code: 'workspace_changed' });
      const repinned: TaskEnvironment = { ...current, updatedAt: deps.clock.now(), message: '运行镜像已升级，下一次恢复使用新镜像',
        render: { ...current.render!, image: image.image, runtimeImage: image, runtimeImageRepin: { operationId: input.operationId, generation: input.generation, versionId: image.versionId } } };
      await scope.environments.update(repinned); return repinned;
    });
  };
}
function assertPaused(env: TaskEnvironment): void {
  if (!env.render?.businessStorage || env.volumeMode !== 'persistent') throw precondition('该环境不是持久业务工作区', { code: 'persistent_volume_required' });
  if (env.state !== 'paused' || env.businessWorkspace?.phase !== 'paused') throw precondition('只有已暂停的业务工作区可以升级运行镜像', { code: 'task_not_paused' });
}
function replayed(env: TaskEnvironment, input: RepinBusinessWorkspaceInput): boolean {
  const prior = env.render?.runtimeImageRepin;
  if (!prior) return false;
  if (prior.operationId === input.operationId) {
    if (prior.generation !== input.generation || prior.versionId !== input.runtimeImage.versionId) throw conflict('升级操作不能改变原世代或目标版本', { code: 'idempotency_conflict' });
    return true;
  }
  if (prior.generation >= input.generation) throw conflict('升级操作世代已过期', { code: 'stale_generation' });
  return false;
}
