import type { TaskId } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import { completeStage } from '../domain/podStartup';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import { EXECUTION_NOUN, purposeOf, wantsProvisioning } from '../domain/taskEnvironment';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { containerEnv } from './containerEnv';
import type { TaskRuntimeUseCaseDeps } from './dependencies';
import { failQueuedExecution } from './nativeExecution';

/** 执行环境建出之前父工作区变了（调和器照观测缓存核对）：只有这一种原因。 */
export type WorkloadUnavailableCode = 'workspace-changed';

/**
 * 资源中心建出工作区与执行环境的容器时回头要的（RFC-025 I25 裁定：渲染时回调，值不落库）：
 * - runnerValues：建 Runner Secret 之前要它的内容——平台约定变量、配置与数据的连接串、新签发的 Runner 令牌；令牌只存哈希。
 *   只在环境要资源中心建出容器（工作区创建中、还没绑定 Pod；执行环境还在排队）时给，其余一律拒绝（调和器不该在这时建）。
 *   执行环境要值时父工作区得还在运行、连着，否则判这个执行环境失败（与本模块自己建时同一条前提）。
 * - bindWorkload：Pod 建出后记下实例（podUid；执行环境另记 Runner Secret 的 UID），「排队分配容器」这一段结束（RFC-022）；
 *   Provisioning 随之变假，调和器不再建。
 * - workloadUnavailable：调和器发现执行环境的父工作区已经换了实例，判这个执行环境失败，文案照本模块自己建时的说法。
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
      if (env.native) await requireRunningWorkspace(deps, env);
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
    bindWorkload: async (taskId: TaskId, podUid: string, secretUid?: string): Promise<void> => {
      const env = await current(taskId);
      await deps.uow.run(async (scope) => {
        await scope.admissions.lock(env.projectId);
        const latest = await scope.environments.getById(taskId);
        if (!latest || !wantsProvisioning(latest)) return;
        await scope.environments.update(bound(deps, latest, podUid, secretUid));
      });
    },
    workloadUnavailable: async (taskId: TaskId, code: WorkloadUnavailableCode): Promise<void> => {
      const env = await current(taskId);
      if (!env.native || code !== 'workspace-changed') return;
      await failQueuedExecution(deps, env, `启动期间原工作区实例或工作卷已变化，此${EXECUTION_NOUN[purposeOf(env.native)]}未启动`, true);
    },
  };
}

/** 建出之后的环境：工作区记下 Pod 实例；执行环境进入「启动中」（记下 Pod 与 Runner Secret 的实例），与本模块自己建时准备完的样子一样。 */
function bound(deps: TaskRuntimeUseCaseDeps, env: TaskEnvironment, podUid: string, secretUid: string | undefined): TaskEnvironment {
  const now = deps.clock.now().toISOString();
  const startup = env.startup ? { startup: completeStage(env.startup, 'queue', now) } : {};
  if (!env.native) return { ...env, podUid, ...startup };
  const noun = EXECUTION_NOUN[purposeOf(env.native)];
  return {
    ...env, updatedAt: deps.clock.now(), message: `此${noun}的执行容器已创建，等待调度和连接`, ...startup,
    native: { ...env.native, state: 'starting', podUid, ...(secretUid ? { secretUid } : {}), preparedAt: now },
  };
}

/** 执行环境要值时父工作区得还在运行、连着；不在就判这个执行环境失败（原工作区已断开），并拒绝给值。 */
async function requireRunningWorkspace(deps: TaskRuntimeUseCaseDeps, env: TaskEnvironment): Promise<void> {
  const parent = await deps.uow.read.environments.getById(env.native!.parentTaskId);
  if (parent?.state === 'running' && parent.connected) return;
  const reason = `原工作区已经断开或释放，此${EXECUTION_NOUN[purposeOf(env.native!)]}未启动`;
  await failQueuedExecution(deps, env, reason, true);
  throw precondition(reason, { taskId: env.id });
}
