import type { EnvironmentRebuild } from '../domain/environmentRebuild';
import { CONTAINER_START_FAILURES, IMAGE_PULL_FAILURES, RUNNER_UNAVAILABLE_HINT, advanceStartup, runningStage } from '../domain/podStartup';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { EXECUTION_NOUN, purposeOf } from '../domain/taskEnvironment';
import type { PodPhaseReading } from '../ports/cluster';
import type { TaskRuntimeUseCaseDeps } from './dependencies';
import type { lifecycleUseCases } from './lifecycle';
import { describeNativeScheduling } from './nativeExecution';

type Lifecycle = ReturnType<typeof lifecycleUseCases>;

/** 对账：容器不在了或已终止而记录仍在运行，就标 failed 并释放配额；不复活任务。 */
export function reconcileUseCase(deps: TaskRuntimeUseCaseDeps, lifecycle: Lifecycle) {
  return async (): Promise<number> => {
    let changed = 0;
    // 作业崩溃或补偿重试耗尽后仍有持久化意图：去重补投，不丢失恢复。
    for (const record of await deps.uow.read.rebuilds.pending()) await deps.uow.read.rebuildQueue.enqueue(record.id);
    for (const env of await deps.uow.read.environments.pendingExecutions()) await deps.uow.read.nativeQueue.enqueue(env.id);
    for (const env of await deps.uow.read.environments.listByStates(['creating', 'running'])) {
      const target = await judgeable(deps, env);
      if (target && await judgeEnvironment(deps, lifecycle, env, target.rebuild, await deps.cluster.podPhase(env))) changed += 1;
    }
    return changed;
  };
}

/**
 * RFC-022 启动观测：每秒看一页启动中的环境——读 Pod（容器启动中时再读 Events）推进阶段细节，并用对账的同一套规则判定失败，
 * 规则一条不变，只是启动中的环境从 15 秒检查一次变为每秒一次。只写离散变化；不改 updatedAt（它是恢复确认用的修订）。
 */
export function observeStartupUseCase(deps: TaskRuntimeUseCaseDeps, lifecycle: Lifecycle, pageSize = 64) {
  let after: string | undefined;
  return async (): Promise<number> => {
    const page = await deps.uow.read.environments.listStarting({ ...(after ? { after } : {}), limit: pageSize });
    after = page.length === pageSize ? page.at(-1)!.id : undefined;
    let changed = 0;
    for (const env of page) {
      const target = await judgeable(deps, env);
      if (!target || !env.startup) continue;
      const read = await deps.cluster.observeStartup(env, { events: runningStage(env.startup) === 'container' });
      if (await judgeEnvironment(deps, lifecycle, env, target.rebuild, read.pod)) { changed += 1; continue; }
      if (read.observation && await recordObservation(deps, env, read.observation)) changed += 1;
    }
    return changed;
  };
}

async function recordObservation(deps: TaskRuntimeUseCaseDeps, env: TaskEnvironment, observation: NonNullable<Awaited<ReturnType<TaskRuntimeUseCaseDeps['cluster']['observeStartup']>>['observation']>): Promise<boolean> {
  if (JSON.stringify(advanceStartup(env.startup!, observation)) === JSON.stringify(env.startup)) return false;
  return deps.uow.run(async (scope) => {
    await scope.admissions.lock(env.projectId);
    // 在最新记录上再推导一次：同时发生的连上、判定失败或重建不被旧读数覆盖。
    const current = await scope.environments.getById(env.id);
    if (!current?.startup || current.podName !== env.podName) return false;
    const next = advanceStartup(current.startup, observation);
    if (JSON.stringify(next) === JSON.stringify(current.startup)) return false;
    await scope.environments.update({ ...current, startup: next });
    return true;
  });
}

/** 排队或清理中的执行环境、排队或替换中的重建由各自的作业处理，不在这里看 Pod。 */
async function judgeable(deps: TaskRuntimeUseCaseDeps, env: TaskEnvironment): Promise<{ rebuild?: EnvironmentRebuild } | undefined> {
  if (env.native?.state === 'queued' || env.native?.state === 'cleaning') return undefined;
  const rebuild = env.rebuildId ? await deps.uow.read.rebuilds.get(env.rebuildId) : undefined;
  if (rebuild && ['queued', 'replacing'].includes(rebuild.state)) return undefined;
  return rebuild ? { rebuild } : {};
}

/** 判定一个环境是否失败（RFC-006 §5.3 的规则）；判了失败返回 true。 */
async function judgeEnvironment(deps: TaskRuntimeUseCaseDeps, lifecycle: Lifecycle, env: TaskEnvironment, rebuild: EnvironmentRebuild | undefined, pod: PodPhaseReading): Promise<boolean> {
  const { phase, message, waitingReason } = pod;
  const noun = env.native ? EXECUTION_NOUN[purposeOf(env.native)] : '';
  // 执行容器拉不到镜像或起不来：立即判失败并回收，不等五分钟（RFC-006 §5.3）。原因里写清是镜像还是底座的问题。
  if (env.native?.state === 'starting' && waitingReason && (IMAGE_PULL_FAILURES.has(waitingReason) || CONTAINER_START_FAILURES.has(waitingReason))) {
    const pull = IMAGE_PULL_FAILURES.has(waitingReason);
    const reason = pull ? `此${noun}的镜像拉取失败（${waitingReason}）` : `此${noun}的执行容器没有起来（${waitingReason}）：${RUNNER_UNAVAILABLE_HINT}`;
    await lifecycle.markFailed(env.id, `${reason}${message ? `；${message}` : ''}`, env.podName, 'creating', pull ? 'image-pull-failed' : 'container-start-failed');
    return true;
  }
  if (env.native?.state === 'starting' && deps.clock.now().getTime() - Date.parse(env.native.preparedAt!) >= 5 * 60_000) {
    await lifecycle.markFailed(env.id, `此${noun}的执行环境超过 5 分钟未连接，其他 Agent 与窗口保持${message ? `；${message}` : ''}`, env.podName, 'creating', 'connect-timeout');
    return true;
  }
  if (env.native?.state === 'starting' && (phase === 'Pending' || phase === 'Running')) await describeNativeScheduling(deps, env,
    phase === 'Pending' ? `等待此${noun}的执行容器就绪${message ? `：${message}` : ''}` : `此${noun}的执行容器已运行，等待环境连接`);
  if (rebuild?.state === 'starting' && env.state === 'creating' && deps.clock.now().getTime() - rebuild.updatedAt.getTime() >= 5 * 60_000) {
    await lifecycle.markFailed(env.id, `新环境启动超过 5 分钟仍未连接，原工作卷保留；请检查套餐和容器镜像后重试${message ? `；${message}` : ''}`, env.podName, 'creating', 'connect-timeout');
    return true;
  }
  if (phase === 'Failed' || phase === 'Succeeded' || phase === 'Missing') {
    const summary = phase === 'Missing' ? '容器不存在' : phase === 'Failed' ? '容器运行失败' : '容器已退出';
    // 执行容器从未连上就退出：多半是镜像不是基于平台底座构建（没有 Runner 启动路径）。
    const hint = env.native?.state === 'starting' && phase !== 'Missing' ? `；${RUNNER_UNAVAILABLE_HINT}` : '';
    await lifecycle.markFailed(env.id, `${summary}${message ? `：${message}` : ''}${hint}`, env.podName, undefined, phase === 'Missing' ? 'pod-missing' : 'pod-exited');
    return true;
  }
  return false;
}
