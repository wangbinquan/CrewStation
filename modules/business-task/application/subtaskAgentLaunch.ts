import type { TaskId } from '@crewstation/contracts';
import { isPlatformError, newId, notFound } from '@crewstation/kernel';
import type { SubtaskRun } from '../domain/subtaskRun';
import { isTerminal, transition } from '../domain/subtaskRun';
import type { BusinessTaskUseCaseDeps } from './dependencies';

/** 业务侧只拿得到子任务的 error 字符串（details 不进 SubtaskRun），档位不存在时可选档位必须写进正文（RFC-001）。 */
function launchFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const available = isPlatformError(error) && Array.isArray(error.details?.available) ? (error.details.available as string[]) : undefined;
  return `启动 Agent 失败：${message}${available ? `，现有档位：${available.join('、') || '（无）'}` : ''}`;
}

type Finish = (run: SubtaskRun, next: SubtaskRun) => Promise<SubtaskRun>;

/** Agent 子任务的启动（RFC-006 §5.4）：固定档位修订 → 登记独立执行环境 → 子 Runner 连上后派发 startAgent。 */
export function subtaskAgentLaunch(deps: BusinessTaskUseCaseDeps, finish: Finish) {
  const { uow, environments, runner, settings, clock, logger } = deps;
  const failLaunch = async (run: SubtaskRun, error: unknown): Promise<SubtaskRun> => {
    const latest = (await uow.read.subtasks.getById(run.id)) ?? run;
    if (isTerminal(latest)) return latest;
    return finish(latest, transition(latest, 'failed', clock.now(), { error: launchFailure(error) }));
  };

  /** 档位修订在构造时没解析成（被删、不可用、没有默认档位）：此刻再解析一次，失败原因原样写进子任务（RFC-006 §4.3）。 */
  const pinProfile = async (run: SubtaskRun): Promise<SubtaskRun> => {
    if (run.computeProfile) return run;
    const task = await uow.read.tasks.getById(run.taskId);
    if (!task) throw notFound('业务任务', run.taskId);
    const resolved = await deps.compute.resolve(run.agentProfile!.compute, 'subtask', task.projectId);
    const pinned: SubtaskRun = { ...run, computeProfile: { profileId: resolved.id, revision: resolved.revision } };
    await uow.run((scope) => scope.subtasks.update(pinned));
    return pinned;
  };

  /**
   * Agent 子任务（RFC-006 §5.4）：业务任务容器连上后登记独立执行环境（挂同一工作卷、占一个项目额度），子 Runner 连上后派发 startAgent。
   * 额度已满等定性原因把子任务置为 failed 并写明原因，由业务程序自行重试（R43）。材料按本 attempt 固定的修订取，重发同一 attempt 不重跑启动前步骤。
   */
  return async (run: SubtaskRun): Promise<SubtaskRun> => {
    let current = run;
    try {
      current = await pinProfile(current);
      let env = current.execution ? await environments.getEnvironment(current.execution.taskId) : undefined;
      if (!env) {
        if (!(await environments.getEnvironment(current.taskId))?.connected) { logger.info('subtask waits for runner', { subtaskId: run.id, taskId: run.taskId }); return current; }
        if (!current.execution) {
          current = { ...current, execution: { taskId: newId('tsk') as TaskId, runnerId: Bun.randomUUIDv7() } };
          await uow.run((scope) => scope.subtasks.update(current));
        }
        const material = await deps.compute.launchMaterial(current.computeProfile!);
        env = await environments.createNativeExecution({ id: current.execution!.taskId, parentTaskId: current.taskId, purpose: 'subtask', agentId: current.runnerRef ?? '', runnerId: current.execution!.runnerId,
          fingerprint: `${current.id}:${current.attempt}`, ...(material.taskProfile ? { profile: material.taskProfile } : {}), image: material.image, computeProfile: { profileId: material.id, revision: material.revision } });
      }
      if (env.native && ['cleaning', 'finished'].includes(env.native.state)) return failLaunch(current, new Error(env.native.failureReason ?? env.message ?? '子任务的执行环境已结束'));
      if (!env.connected) return current;
      const started = transition(current, 'running', clock.now(), { startedAt: clock.now() });
      await uow.run((scope) => scope.subtasks.update(started));
      current = started;
      const material = await deps.compute.launchMaterial(started.computeProfile!);
      await runner.sendCommand(env.id, {
        id: `start-${run.runnerRef}`, type: 'startAgent', agentId: run.runnerRef ?? '', compute: material.id, profileRevision: material.revision,
        launch: material.launch, beforeStart: material.beforeStart, processAttemptId: `${run.runnerRef}:${run.attempt}`, permission: run.agentProfile!.permission,
        mode: run.mode ?? 'oneshot', ...(run.cwd ? { cwd: run.cwd } : {}), initialPrompt: run.prompt ?? '', mcp: settings.mcp.map((m) => ({ name: m.name, url: m.url, headers: {} })), env: {},
      });
      return started;
    } catch (error) {
      return failLaunch(current, error);
    }
  };
}
