import { conflict, jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { developmentParentEpochHash, hasDevelopmentParentEnding, readDevelopmentParentEnding, snapshotDevelopmentParentEpoch } from '../../../domain/development/parentEnding';
import type { DevelopmentParentEpoch } from '../../../domain/development/parentEnding';
import type { TaskEnvironment } from '../../../domain/taskEnvironment';
import type { DevelopmentParentEnding, DevelopmentParentEndingOperation } from '../../../ports/developmentParentEnding';
import type { RepositoryScope } from '../../../ports/unitOfWork';
import type { TaskRuntimeUseCaseDeps } from '../../dependencies';
import { retainedVolume } from '../../rebuildInspection';
import { originalParentCompletion, requireParentCompletionTransition } from '../../../domain/development/parentCompletion';
import { DevelopmentParentRebuildBindingSchema } from '../../../domain/development/parentRebuildBinding';

export type DevelopmentParentAdmission = { readonly original: TaskEnvironment; readonly epoch: DevelopmentParentEpoch; readonly epochHash: string; readonly nodeName?: string };
/** Selection includes malformed presence and every accepted child, never the first page or active-only rows. */
export async function selectedDevelopmentParent(scope: RepositoryScope, env: TaskEnvironment): Promise<boolean> {
  if (env.native || env.kind !== 'dev-session') return false;
  if (hasDevelopmentParentEnding(env) || !!env.render?.rebuild && Object.hasOwn(env.render.rebuild, 'developmentParentSelection')) return true;
  const record = env.rebuildId ? await scope.rebuilds.get(env.rebuildId) : undefined;
  if (record && Object.hasOwn(record, 'developmentParentBinding')) {
    DevelopmentParentRebuildBindingSchema.parse(record.developmentParentBinding);
    if (record.taskId !== env.id || record.projectId !== env.projectId || record.namespace !== env.namespace || record.podName !== env.podName
      || record.pvcName !== env.pvcName || record.podUid && env.podUid !== record.podUid) throw precondition('原恢复 epoch 的私有绑定已变化');
    return true;
  }
  return !!await scope.environments.hasProtectedDevelopmentChildren?.(env.id);
}
/** All physical reads happen before taking any Project/Task/Resource lock. */
export async function prepareDevelopmentParentEnding(deps: Pick<TaskRuntimeUseCaseDeps, 'uow' | 'developmentParentInspector'>, env: TaskEnvironment): Promise<DevelopmentParentAdmission | undefined> {
  if (!await selectedDevelopmentParent(deps.uow.read, env)) return undefined;
  if (!deps.uow.read.parentEnding || !deps.uow.read.environments.getMaintenanceView) throw precondition('原父结束持久受理能力未装配');
  const view = await deps.uow.read.environments.getMaintenanceView(env.id);
  if (view?.status !== 'present') throw precondition('原父受理材料存在非法值，等待原任务恢复');
  env = view.environment;
  const pointer = readDevelopmentParentEnding(env);
  if (pointer) {
    const stored = await deps.uow.read.parentEnding.endings.get(pointer.endingId);
    if (!stored || stored.parentId !== env.id || stored.projectId !== env.projectId || stored.epochHash !== pointer.epochHash)
      throw precondition('原父结束受理身份尚未恢复', { code: 'development_parent_ending_invalid' });
    if (pointer.phase === 'complete') {
      const witness = originalParentCompletion(stored.completionWitness, stored);
      if (stored.phase !== 'complete' || stored.status !== 'complete') throw precondition('原父完成转换已变化');
      requireParentCompletionTransition(env, stored, witness);
      return { original: env, epoch: stored.epoch, epochHash: stored.epochHash };
    }
    const epoch = snapshotDevelopmentParentEpoch(env, { podUid: stored.epoch.podUid, pvcUid: stored.epoch.pvcUid });
    if (developmentParentEpochHash(epoch) !== stored.epochHash) throw precondition('原父结束材料已变化');
    return { original: env, epoch, epochHash: stored.epochHash };
  }
  if (!deps.developmentParentInspector) throw precondition('原父物理身份读取能力未装配');
  const actual = await deps.developmentParentInspector.inspect(env), volume = retainedVolume(actual);
  if (!actual.pod) throw precondition('原父 Pod 缺少实际退出证明，等待原物理身份恢复');
  const epoch = snapshotDevelopmentParentEpoch(env, { podUid: actual.pod.uid, pvcUid: volume.uid });
  return { original: env, epoch, epochHash: developmentParentEpochHash(epoch), ...(actual.pod.nodeName ? { nodeName: actual.pod.nodeName } : {}) };
}
/** The caller holds the original Project lock. Membership, private seal, projection and durable queue commit together. */
export async function admitDevelopmentParentEnding(scope: RepositoryScope, prepared: DevelopmentParentAdmission, operation: DevelopmentParentEndingOperation,
  intent: Readonly<Record<string, unknown>>, now: Date): Promise<{ environment: TaskEnvironment; ending: DevelopmentParentEnding }> {
  const current = await scope.environments.getForUpdate(prepared.original.id);
  if (!current || current.native || current.kind !== 'dev-session' || current.projectId !== prepared.original.projectId || !scope.parentEnding)
    throw precondition('原开发父结束受理身份已变化');
  const epoch = snapshotDevelopmentParentEpoch(current, { podUid: prepared.epoch.podUid, pvcUid: prepared.epoch.pvcUid });
  if (developmentParentEpochHash(epoch) !== prepared.epochHash) throw conflict('原父工作区材料已变化，请重新检查');
  const pointer = readDevelopmentParentEnding(current);
  if (pointer) {
    const ending = await scope.parentEnding.endings.get(pointer.endingId, true);
    if (!ending || ending.parentId !== current.id || ending.epochHash !== prepared.epochHash || ending.phase !== pointer.phase)
      throw precondition('原父结束指针和持久记录不一致');
    if (ending.operation !== operation || jsonHash(ending.intent) !== jsonHash(intent)) throw conflict('原父已有另一项退出受理');
    if (ending.phase !== 'complete') await scope.parentEnding.queue.enqueue(ending.id);
    return { environment: current, ending };
  }
  const id = newResourceId();
  const ending = await scope.parentEnding.endings.admit({ id, parentId: current.id, projectId: current.projectId, operation,
    epoch, epochHash: prepared.epochHash, selectionHash: jsonHash({ version: 1, epochHash: prepared.epochHash, operation, intent }), intent }, now);
  const environment: TaskEnvironment = { ...current, parentEnding: { version: 1, endingId: ending.id, epochHash: ending.epochHash, phase: ending.phase },
    message: '等待原子执行排空及原工作区停止确认' };
  await scope.environments.update(environment); await scope.parentEnding.queue.enqueue(ending.id);
  return { environment, ending };
}
