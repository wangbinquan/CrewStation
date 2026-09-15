import type { TaskRuntimeUseCaseDeps } from './dependencies';
import type { lifecycleUseCases } from './lifecycle';
import { describeNativeScheduling } from './nativeExecution';

/** 对账：容器不在了或已终止而记录仍在运行，就标 failed 并释放配额；不复活任务。 */
export function reconcileUseCase(deps: TaskRuntimeUseCaseDeps, lifecycle: ReturnType<typeof lifecycleUseCases>) {
  return async (): Promise<number> => {
    let changed = 0;
    // 作业崩溃或补偿重试耗尽后仍有持久化意图：去重补投，不丢失恢复。
    for (const record of await deps.uow.read.rebuilds.pending()) await deps.uow.read.rebuildQueue.enqueue(record.id);
    for (const env of await deps.uow.read.environments.pendingExecutions()) await deps.uow.read.nativeQueue.enqueue(env.id);
    for (const env of await deps.uow.read.environments.listByStates(['creating', 'running'])) {
      if (env.native?.state === 'queued' || env.native?.state === 'cleaning') continue;
      const rebuild = env.rebuildId ? await deps.uow.read.rebuilds.get(env.rebuildId) : undefined;
      if (rebuild && ['queued', 'replacing'].includes(rebuild.state)) continue;
      const { phase, message } = await deps.cluster.podPhase(env);
      if (env.native?.state === 'starting' && deps.clock.now().getTime() - Date.parse(env.native.preparedAt!) >= 5 * 60_000) {
        await lifecycle.markFailed(env.id, `CLI 环境超过 5 分钟未连接，其他窗口保持${message ? `；${message}` : ''}`, env.podName, 'creating');
        changed += 1; continue;
      }
      if (env.native?.state === 'starting' && (phase === 'Pending' || phase === 'Running')) await describeNativeScheduling(deps, env,
        phase === 'Pending' ? `等待 CLI 容器就绪${message ? `：${message}` : ''}` : 'CLI 容器已运行，等待环境连接');
      if (rebuild?.state === 'starting' && env.state === 'creating' && deps.clock.now().getTime() - rebuild.updatedAt.getTime() >= 5 * 60_000) {
        await lifecycle.markFailed(env.id, `新环境启动超过 5 分钟仍未连接，原工作卷保留；请检查套餐和容器镜像后重试${message ? `；${message}` : ''}`, env.podName, 'creating');
        changed += 1; continue;
      }
      if (phase === 'Failed' || phase === 'Succeeded' || phase === 'Missing') {
        const summary = phase === 'Missing' ? '容器不存在' : phase === 'Failed' ? '容器运行失败' : '容器已退出';
        await lifecycle.markFailed(env.id, `${summary}${message ? `：${message}` : ''}`, env.podName);
        changed += 1;
      }
    }
    return changed;
  };
}
