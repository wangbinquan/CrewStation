import { ResourceIdSchema } from '@crewstation/contracts';
import { conflict, jsonHash, notFound, precondition } from '@crewstation/kernel';
import type { RebuildBusinessWorkspaceInput } from '../../api/businessRecovery';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import { transition } from '../../domain/taskEnvironment';
import { initialStartup } from '../../domain/podStartup';
import { hashRunnerToken, newRunnerToken } from '../../domain/runnerToken';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import { inspectBusinessRecovery } from './recoveryInspection';

/** Rebuild the retained workspace once. No default image lookup, empty volume or implicit old-Pod deletion. */
export function rebuildBusinessWorkspace(deps: TaskRuntimeUseCaseDeps) {
  const inspect = inspectBusinessRecovery(deps);
  return async (input: RebuildBusinessWorkspaceInput): Promise<TaskEnvironment> => {
    ResourceIdSchema.parse(input.operationId);
    if (!Number.isSafeInteger(input.generation) || input.generation < 1) throw precondition('恢复世代无效');
    const original = await deps.uow.read.environments.getById(input.taskId);
    if (!original || original.projectId !== input.projectId || original.serviceId !== input.serviceId) throw notFound('业务工作区', input.taskId);
    if (replayed(original, input)) return original;
    if (original.kind !== 'business' || original.native || original.state !== 'failed' || !original.render?.businessStorage || original.volumeMode !== 'persistent') throw precondition('只有明确失败的持久业务工作区可以重建');
    if (!original.businessWorkspace || original.businessWorkspace.volumeUid !== input.volumeUid) throw precondition('原工作卷身份已变化', { code: 'workspace_volume_changed' });
    const proof = await inspect(input);
    if (!proof?.volumeVerified) throw precondition('原工作卷缺失或实例已变化', { code: 'workspace_volume_changed' });
    if (!proof.stopped) throw precondition('旧执行尚未确认停止', { code: 'workspace_cleanup_pending' });
    if (proof.activeChildren) throw precondition('原工作区仍有活动子执行', { code: 'active_subtasks' });
    const limit = (await deps.quotas.quotaLimit(original.projectId)) ?? 0;
    return deps.uow.run(async (scope) => {
      await scope.admissions.lock(original.projectId);
      const current = await scope.environments.getById(original.id);
      if (!current) throw notFound('业务工作区', original.id);
      if (replayed(current, input)) return current;
      if (jsonHash(current) !== jsonHash(original)) throw conflict('检查后工作区已变化，请重新评估', { code: 'workspace_changed' });
      if ((await scope.environments.listChildren(current.id)).some((c) => c.native?.state !== 'finished')) throw conflict('检查后新增了活动子执行', { code: 'active_subtasks' });
      const now = deps.clock.now();
      const rebuilt = transition(current, 'creating', now, { connected: false, podUid: undefined, runnerRejection: undefined, runtimeInitialization: undefined,
        runnerTokenHash: hashRunnerToken(newRunnerToken()), startup: initialStartup(now), message: '正在用原工作卷重建业务执行环境',
        render: { ...current.render!, start: current.render!.start + 1, businessRecovery: { operationId: input.operationId, generation: input.generation, volumeUid: input.volumeUid } },
        businessWorkspace: { ...current.businessWorkspace!, phase: 'resuming' },
      });
      await scope.quota.acquire(rebuilt, limit, `并发任务已达配额上限 ${limit}`);
      await scope.environments.update(rebuilt); return rebuilt;
    });
  };
}
function replayed(env: TaskEnvironment, input: RebuildBusinessWorkspaceInput): boolean {
  const prior = env.render?.businessRecovery;
  if (!prior) return false;
  if (prior.operationId === input.operationId) {
    if (prior.generation !== input.generation || prior.volumeUid !== input.volumeUid) throw conflict('恢复操作不能改变原世代或工作卷', { code: 'idempotency_conflict' });
    return true;
  }
  if (prior.generation >= input.generation) throw conflict('恢复操作世代已过期', { code: 'stale_generation' });
  return false;
}
