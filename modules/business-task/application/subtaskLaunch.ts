import type { ProfileRevisionRef, SubmitSubtaskRequest, SubtaskId } from '@crewstation/contracts';
import { isPlatformError, newId, validation } from '@crewstation/kernel';
import type { BusinessTask } from '../domain/businessTask';
import { resolveContract, resolveProfile } from '../domain/contractRegistry';
import type { SubtaskRun } from '../domain/subtaskRun';
import { isTerminal, transition } from '../domain/subtaskRun';
import type { BusinessTaskUseCaseDeps } from './dependencies';
import { subtaskRefresh } from './subtaskRefresh';

interface ExecResult { execId: string; exitCode: number | null; stdout: string; stderr: string; truncated: boolean }

/** 业务侧只拿得到子任务的 error 字符串（details 不进 SubtaskRun），档位不存在时可选档位必须写进正文（RFC-001）。 */
function launchFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const available = isPlatformError(error) && Array.isArray(error.details?.available) ? (error.details.available as string[]) : undefined;
  return `启动 Agent 失败：${message}${available ? `，当前可用：${available.join('、') || '（无）'}` : ''}`;
}

/** 构造与启动子任务：Agent 走 startAgent，命令走 exec(wait) 并在后台收尾。 */
export function subtaskLaunch(deps: BusinessTaskUseCaseDeps) {
  const { uow, environments, runner, settings, clock, logger } = deps;
  const { finish } = subtaskRefresh(deps);

  const settleCommand = async (run: SubtaskRun, r: ExecResult): Promise<void> => {
    const current = await uow.read.subtasks.getById(run.id);
    if (!current || isTerminal(current)) return;
    const exitCode = r.exitCode ?? -1;
    const output = `${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`.slice(0, settings.outputLimitBytes);
    await finish(current, transition(current, exitCode === 0 ? 'succeeded' : 'failed', clock.now(), { exitCode, output, ...(exitCode === 0 ? {} : { error: `命令退出码 ${exitCode}` }) }));
  };

  const failCommand = async (run: SubtaskRun, error: unknown): Promise<void> => {
    const current = await uow.read.subtasks.getById(run.id);
    if (current && !isTerminal(current)) await finish(current, transition(current, 'failed', clock.now(), { error: error instanceof Error ? error.message : String(error) }));
    logger.warn('command subtask failed to run', { subtaskId: run.id, error: String(error) });
  };

  /**
   * 容器刚创建时 TaskRunner 还没连上，此时派发必然以「TaskRunner 未连接」失败。
   * 子任务留在 pending，等 onRunnerConnected 再派发；调用方本来就要轮询子任务状态。
   */
  const launch = async (run: SubtaskRun): Promise<SubtaskRun> => {
    const env = await environments.getEnvironment(run.taskId);
    if (!env?.connected) {
      logger.info('subtask waits for runner', { subtaskId: run.id, taskId: run.taskId, state: env?.state });
      return run;
    }
    let started = transition(run, 'running', clock.now(), { startedAt: clock.now() });
    await uow.run((scope) => scope.subtasks.update(started));
    if (run.kind === 'agent' && run.agentProfile) {
      try {
        // 构造时没解析成（档位被删、不可用、没有默认档位）：此刻再解析一次，失败原因原样写进子任务（RFC-006 §4.3）。
        if (!started.computeProfile) {
          const resolved = await deps.compute.resolve(run.agentProfile.compute, 'subtask');
          const pinned: ProfileRevisionRef = { profile: resolved.name, revision: resolved.revision };
          started = { ...started, computeProfile: pinned };
          await uow.run((scope) => scope.subtasks.update(started));
        }
        // 材料按本 attempt 固定的修订取，重发同一 attempt 不重跑启动前步骤（RFC-004 §5 沿用）。
        const material = await deps.compute.launchMaterial(started.computeProfile!);
        await runner.sendCommand(run.taskId, {
          id: `start-${run.runnerRef}`, type: 'startAgent', agentId: run.runnerRef ?? '', compute: material.name, profileRevision: material.revision,
          launch: material.launch, beforeStart: material.beforeStart, processAttemptId: `${run.runnerRef}:${run.attempt}`, permission: run.agentProfile.permission,
          mode: run.mode ?? 'oneshot', ...(run.cwd ? { cwd: run.cwd } : {}), initialPrompt: run.prompt ?? '', mcp: settings.mcp.map((m) => ({ name: m.name, url: m.url, headers: {} })), env: {},
        });
      } catch (error) {
        const failed = transition(started, 'failed', clock.now(), { error: launchFailure(error) });
        await finish(started, failed);
        return failed;
      }
      return started;
    }
    const execId = run.runnerRef ?? '';
    void runner.sendCommand(run.taskId, { id: `exec-${execId}`, type: 'exec', execId, command: run.command ?? [], ...(run.cwd ? { cwd: run.cwd } : {}), env: {}, timeoutSeconds: run.timeoutSeconds ?? 3600, wait: true })
      .then((result) => settleCommand(run, result as ExecResult))
      .catch((error: unknown) => failCommand(run, error));
    return started;
  };

  return {
    launch,
    /** TaskRunner 连上时由组合根调用：把等容器的 pending 子任务按提交顺序派发出去。 */
    dispatchPending: async (taskId: SubtaskRun['taskId']): Promise<number> => {
      let dispatched = 0;
      for (const run of await uow.read.subtasks.listByTask(taskId)) {
        if (run.state !== 'pending') continue;
        if ((await launch(run)).state !== 'pending') dispatched += 1;
      }
      return dispatched;
    },
    build: async (task: BusinessTask, input: SubmitSubtaskRequest, attempt: number): Promise<SubtaskRun> => {
      const now = clock.now();
      const base = { id: newId('sub') as SubtaskId, taskId: task.id, name: input.name, state: 'pending' as const, attempt, createdAt: now, ...(input.cwd ? { cwd: input.cwd } : {}) };
      if (input.kind === 'command') return { ...base, kind: 'command', command: input.command, timeoutSeconds: input.timeoutSeconds, runnerRef: newId('exe') };
      const registration = await uow.read.contracts.latest(task.serviceId);
      const profile = resolveProfile(registration, input.agentProfile);
      if (!profile) throw validation(`agentProfile ${input.agentProfile} 未在该服务的发布中登记`, { registered: registration?.agentProfiles.map((p) => p.name) ?? [] });
      const contract = input.outputContract ? resolveContract(registration, input.outputContract) : undefined;
      if (input.outputContract && !contract) throw validation(`outputContract ${input.outputContract} 未在该服务的发布中登记`);
      // 每个 attempt 在构造时固定档位修订，`default` 在此刻解析（C17）；解析失败留给启动时按同一原因把子任务置为失败。
      const pinned = await deps.compute.resolve(profile.compute, 'subtask').then((r): ProfileRevisionRef => ({ profile: r.name, revision: r.revision }), () => undefined);
      return { ...base, kind: 'agent', mode: input.mode, prompt: input.prompt, agentProfile: profile, ...(contract ? { outputContract: contract } : {}), ...(pinned ? { computeProfile: pinned } : {}), runnerRef: newId('agt') };
    },
  };
}
