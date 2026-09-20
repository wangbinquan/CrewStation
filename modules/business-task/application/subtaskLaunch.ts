import type { ProfileRevisionRef, SubmitSubtaskRequest, SubtaskId } from '@crewstation/contracts';
import { newId, validation } from '@crewstation/kernel';
import type { BusinessTask } from '../domain/businessTask';
import { resolveContract, resolveProfile } from '../domain/contractRegistry';
import type { SubtaskRun } from '../domain/subtaskRun';
import { isTerminal, transition } from '../domain/subtaskRun';
import type { BusinessTaskUseCaseDeps } from './dependencies';
import { subtaskAgentLaunch } from './subtaskAgentLaunch';
import { subtaskRefresh } from './subtaskRefresh';

interface ExecResult { execId: string; exitCode: number | null; stdout: string; stderr: string; truncated: boolean }

/** 构造与启动子任务：Agent 走 startAgent，命令走 exec(wait) 并在后台收尾。 */
export function subtaskLaunch(deps: BusinessTaskUseCaseDeps) {
  const { uow, environments, runner, settings, clock, logger } = deps;
  const { finish } = subtaskRefresh(deps);
  const launchAgent = subtaskAgentLaunch(deps, finish);

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
    if (run.kind === 'agent' && run.agentProfile) return launchAgent(run);
    const env = await environments.getEnvironment(run.taskId);
    if (!env?.connected) {
      logger.info('subtask waits for runner', { subtaskId: run.id, taskId: run.taskId, state: env?.state });
      return run;
    }
    const started = transition(run, 'running', clock.now(), { startedAt: clock.now() });
    await uow.run((scope) => scope.subtasks.update(started));
    const execId = run.runnerRef ?? '';
    void runner.sendCommand(run.taskId, { id: `exec-${execId}`, type: 'exec', execId, command: run.command ?? [], ...(run.cwd ? { cwd: run.cwd } : {}), env: {}, timeoutSeconds: run.timeoutSeconds ?? 3600, wait: true })
      .then((result) => settleCommand(run, result as ExecResult))
      .catch((error: unknown) => failCommand(run, error));
    return started;
  };

  return {
    launch,
    /**
     * TaskRunner 连上时由组合根调用：业务任务容器连上 → 按提交顺序为等容器的子任务登记执行环境（命令子任务直接执行）；
     * 某个子任务的子 Runner 连上 → 派发它的 startAgent（RFC-006）。返回本次真正开始执行的子任务数。
     */
    dispatchPending: async (taskId: SubtaskRun['taskId']): Promise<number> => {
      const owner = await uow.read.subtasks.findByExecution(taskId);
      if (owner) return owner.state === 'pending' && (await launch(owner)).state !== 'pending' ? 1 : 0;
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
      const pinned = await deps.compute.resolve(profile.compute, 'subtask', task.projectId).then((r): ProfileRevisionRef => ({ profile: r.name, revision: r.revision }), () => undefined);
      return { ...base, kind: 'agent', mode: input.mode, prompt: input.prompt, agentProfile: profile, ...(contract ? { outputContract: contract } : {}), ...(pinned ? { computeProfile: pinned } : {}), runnerRef: newId('agt') };
    },
  };
}
