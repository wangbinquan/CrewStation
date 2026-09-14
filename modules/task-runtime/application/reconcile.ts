import type { TaskRuntimeUseCaseDeps } from './dependencies';
import type { lifecycleUseCases } from './lifecycle';

/** 对账：容器不在了或已终止而记录仍在运行，就标 failed 并释放配额；不复活任务。 */
export function reconcileUseCase(deps: TaskRuntimeUseCaseDeps, lifecycle: ReturnType<typeof lifecycleUseCases>) {
  return async (): Promise<number> => {
    let changed = 0;
    for (const env of await deps.uow.read.environments.listByStates(['creating', 'running'])) {
      const { phase, message } = await deps.cluster.podPhase(env);
      if (phase === 'Failed' || phase === 'Succeeded' || phase === 'Missing') {
        const summary = phase === 'Missing' ? '容器不存在' : phase === 'Failed' ? '容器运行失败' : '容器已退出';
        await lifecycle.markFailed(env.id, `${summary}${message ? `：${message}` : ''}`);
        changed += 1;
      }
    }
    return changed;
  };
}
