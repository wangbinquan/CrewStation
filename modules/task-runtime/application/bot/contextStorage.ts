import type { BotContextIdentity, BotContextStorage, TaskId } from '@crewstation/contracts';
import { BotContextIdentitySchema, ResourceIdSchema } from '@crewstation/contracts';
import { conflict, notFound, precondition } from '@crewstation/kernel';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import type { RepositoryScope } from '../../ports/unitOfWork';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import type { NativeExecutionCluster } from '../../ports/cluster';
type NativeExecutionDeps = TaskRuntimeUseCaseDeps & { nativeCluster: NativeExecutionCluster };
import { storageStopProved } from '../business/storageStop';

/** Lazy declaration; only cluster-control creates the PVC. UID is fixed before any Bot Pod admission. */
export function prepareBotContextUseCase(deps: NativeExecutionDeps) {
  return async (taskId: TaskId, conversationId: string): Promise<{ volumeUid: string } | undefined> => {
    ResourceIdSchema.parse(conversationId);
    const initial = await deps.uow.read.environments.getById(taskId);
    if (!initial) throw notFound('开发会话', taskId);
    return deps.uow.run(async (scope) => {
      await scope.admissions.lock(initial.projectId);
      const env = (await scope.environments.getById(taskId))!;
      if (env.kind !== 'dev-session' || env.native || env.state !== 'running' || !env.connected || !env.render || deps.creation !== 'ledger') throw precondition('开发会话尚不能保存 Bot 上下文');
      if (!deps.nativeCluster.inspectBotVolume || !deps.workloadSafety) throw precondition('Bot 持久上下文保护不可用');
      const current = env.render.botVolume;
      if (current && current.conversationId !== conversationId) throw conflict('开发会话已经绑定其他默认 Bot');
      const volume = current ?? { conversationId, pvcName: `bot-${taskId.replaceAll('-', '')}`, size: '1Gi' as const };
      if (!current) await scope.environments.update({ ...env, render: { ...env.render, botVolume: volume } });
      const observed = await deps.nativeCluster.inspectBotVolume(env, volume.pvcName);
      if (!observed) {
        if (volume.volumeUid) throw precondition('原 Bot 上下文卷已丢失', { code: 'bot_context_unavailable' });
        return undefined;
      }
      if (volume.volumeUid && volume.volumeUid !== observed.uid) throw precondition('原 Bot 上下文卷实例已变化', { code: 'bot_context_unavailable' });
      if (!volume.volumeUid) await scope.environments.update({ ...env, render: { ...env.render, botVolume: { ...volume, volumeUid: observed.uid } } });
      return { volumeUid: observed.uid };
    });
  };
}

export interface BotExecutionContext extends BotContextIdentity { mode: 'create' | 'existing'; expectedPreviousExecutionId?: TaskId }

/** Project admission lock and physical stop proof jointly fence every writer, including other epochs. */
export async function admitBotContext(deps: NativeExecutionDeps, scope: RepositoryScope, parent: TaskEnvironment, input: BotExecutionContext): Promise<BotContextStorage> {
  BotContextIdentitySchema.parse({ conversationId: input.conversationId, epoch: input.epoch });
  const volume = parent.render?.botVolume;
  if (!volume?.volumeUid || volume.conversationId !== input.conversationId || !deps.nativeCluster.inspectBotVolume || !deps.workloadSafety) throw precondition('Bot 上下文尚未就绪');
  const current = await deps.nativeCluster.inspectBotVolume(parent, volume.pvcName);
  if (current?.uid !== volume.volumeUid) throw precondition('原 Bot 上下文卷不可用', { code: 'bot_context_unavailable' });
  const writers = (await scope.environments.listChildren(parent.id)).filter((child) => child.render?.botContext);
  const previous = input.expectedPreviousExecutionId ? writers.find((child) => child.id === input.expectedPreviousExecutionId) : undefined;
  if (input.expectedPreviousExecutionId && !previous) throw precondition('缺少上一次 Bot 执行的停止证明');
  for (const child of writers) {
    if (child.native?.state !== 'finished' || !await storageStopProved(deps, child)) throw precondition('正在确认原 Bot 执行已停止', { code: 'bot_execution_stopping' });
  }
  const sameEpoch = writers.filter((child) => child.render!.botContext!.epoch === input.epoch);
  if (input.mode === 'existing' && (!previous || previous.render?.botContext?.epoch !== input.epoch)) throw precondition('恢复必须指向同一上下文的原执行');
  if (input.mode === 'create' && sameEpoch.length) throw conflict('该 Bot 上下文已经使用，不能重新初始化');
  return { version: 1, ownerTaskId: parent.id, conversationId: input.conversationId, epoch: input.epoch, mode: input.mode, pvcName: volume.pvcName, volumeUid: volume.volumeUid };
}
