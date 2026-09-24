import type { TaskId } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import { completeStage } from '../domain/podStartup';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import { wantsProvisioning } from '../domain/taskEnvironment';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { containerEnv } from './containerEnv';
import type { TaskRuntimeUseCaseDeps } from './dependencies';

/**
 * 资源中心建出工作区容器时回头要的两样（RFC-025 I25 裁定：渲染时回调，值不落库）：
 * - runnerValues：建 Runner Secret 之前要它的内容——平台约定变量、配置与数据的连接串、新签发的 Runner 令牌；令牌只存哈希。
 *   只在环境要资源中心建出容器（创建中、还没绑定 Pod）时给，其余一律拒绝（调和器不该在这时建）。
 * - bindWorkload：Pod 建出后记下实例（podUid），「排队分配容器」这一段结束（RFC-022）；Provisioning 随之变假，调和器不再建。
 */
export function workloadRenderUseCases(deps: TaskRuntimeUseCaseDeps) {
  const current = async (taskId: TaskId): Promise<TaskEnvironment> => {
    const env = await deps.uow.read.environments.getById(taskId);
    if (!env) throw notFound('任务', taskId);
    return env;
  };
  return {
    runnerValues: async (taskId: TaskId): Promise<Record<string, string>> => {
      const env = await current(taskId);
      if (!wantsProvisioning(env)) throw precondition('这个环境眼下不需要建出容器', { taskId, state: env.state });
      const svc = await deps.services.resolveServiceById(env.serviceId);
      if (!svc) throw precondition('环境所属的服务已不存在', { taskId });
      const token = newRunnerToken();
      const values = await containerEnv(deps, env, svc, token);
      // 在项目锁下核对仍是同一次启动，再换上新令牌的哈希：并发的失败、释放与恢复不被这次覆盖。
      await deps.uow.run(async (scope) => {
        await scope.admissions.lock(env.projectId);
        const latest = await scope.environments.getById(taskId);
        if (!latest || !wantsProvisioning(latest) || latest.render?.start !== env.render?.start) throw precondition('环境已经变化，不再建出这次的容器', { taskId });
        await scope.environments.update({ ...latest, runnerTokenHash: hashRunnerToken(token) });
      });
      return values;
    },
    bindWorkload: async (taskId: TaskId, podUid: string): Promise<void> => {
      const env = await current(taskId);
      await deps.uow.run(async (scope) => {
        await scope.admissions.lock(env.projectId);
        const latest = await scope.environments.getById(taskId);
        if (!latest || !wantsProvisioning(latest)) return;
        await scope.environments.update({ ...latest, podUid, ...(latest.startup ? { startup: completeStage(latest.startup, 'queue', deps.clock.now().toISOString()) } : {}) });
      });
    },
  };
}
