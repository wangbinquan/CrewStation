import type { TaskId } from '@crewstation/contracts';
import { isPlatformError } from '@crewstation/kernel';
import type { RebuildRendering } from '../ports/rebuildRendering';
import type { RebuildExecutionDeps, RebuildHeartbeat } from './rebuildExecution';
import { beginReplace, compensateRebuild, executeRebuild, rebuildFailureMessage, requireRebuildLease } from './rebuildExecution';

/** 调和器持逐资源租约，本模块持项目锁：沿用重建状态机，物理创建由调和器的受限操作完成。 */
export function reconcileRebuildUseCase(deps: RebuildExecutionDeps) {
  return async (taskId: TaskId, id: string, operations: RebuildRendering, heartbeat: RebuildHeartbeat): Promise<void> => {
    const original = await deps.uow.read.rebuilds.get(id);
    if (!original || original.taskId !== taskId || original.creation !== 'ledger') return;
    const bound: RebuildExecutionDeps = { ...deps, provisioner: {
      prepareSecret: (record, values) => operations.prepareSecret(values, record.secretUid),
      ensurePod: (record) => operations.ensurePod(record.podUid), ensurePreview: () => operations.ensurePreview(), cleanup: (record) => operations.cleanup(record),
    } };
    try {
      await deps.uow.run(async (scope) => {
        await scope.admissions.lock(original.projectId);
        await requireRebuildLease(heartbeat);
        const record = await scope.rebuilds.get(id), env = await scope.environments.getById(taskId);
        if (!record || !env || env.rebuildId !== id || env.render?.rebuild?.id !== id || env.state !== 'creating' || !['queued', 'replacing'].includes(record.state)) return;
        if (record.input.reason === 'administrator-restart' && (await scope.environments.listChildren(taskId)).some((child) => child.native && child.native.state !== 'finished')) return;
        if (record.state === 'queued') await beginReplace(deps, scope, record);
        const replacing = { ...record, state: 'replacing' as const };
        if (record.failureReason) await compensateRebuild(bound, scope, replacing, (await scope.environments.getById(taskId))!, heartbeat);
        else await executeRebuild(bound, scope, replacing, (await scope.environments.getById(taskId))!, heartbeat);
      });
    } catch (error) {
      await requireRebuildLease(heartbeat);
      await deps.uow.run(async (scope) => {
        await scope.admissions.lock(original.projectId);
        await requireRebuildLease(heartbeat);
        const record = await scope.rebuilds.get(id);
        if (!record || !['queued', 'replacing'].includes(record.state)) return;
        const attempts = (record.attempts ?? 0) + 1, terminal = attempts >= 5 || (isPlatformError(error) && error.kind === 'precondition');
        await scope.rebuilds.update({ ...record, attempts, updatedAt: deps.clock.now(), message: rebuildFailureMessage(error),
          ...(terminal && !record.failureReason ? { failureReason: `${isPlatformError(error) && error.kind === 'precondition' ? error.message : '新环境准备失败，原工作卷保留'}；清理本次容器后可重新检查恢复` } : {}) });
      });
      throw new Error('恢复尚未完成，将按记录继续重试或清理');
    }
  };
}
