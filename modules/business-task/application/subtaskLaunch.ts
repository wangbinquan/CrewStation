import type { SubmitSubtaskRequest, SubtaskId } from '@crewstation/contracts';
import { newId, validation } from '@crewstation/kernel';
import type { BusinessTask } from '../domain/businessTask';
import { resolveContract, resolveProfile } from '../domain/contractRegistry';
import type { SubtaskRun } from '../domain/subtaskRun';
import { isTerminal, transition } from '../domain/subtaskRun';
import type { BusinessTaskUseCaseDeps } from './dependencies';
import { subtaskRefresh } from './subtaskRefresh';

interface ExecResult { execId: string; exitCode: number | null; stdout: string; stderr: string; truncated: boolean }

/** 构造与启动子任务：Agent 走 startAgent，命令走 exec(wait) 并在后台收尾。 */
export function subtaskLaunch(deps: BusinessTaskUseCaseDeps) {
  const { uow, runner, settings, clock, logger } = deps;
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

  return {
    launch: async (run: SubtaskRun): Promise<SubtaskRun> => {
      const started = transition(run, 'running', clock.now(), { startedAt: clock.now() });
      await uow.run((scope) => scope.subtasks.update(started));
      if (run.kind === 'agent' && run.agentProfile) {
        try {
          await runner.sendCommand(run.taskId, {
            id: `start-${run.runnerRef}`, type: 'startAgent', agentId: run.runnerRef ?? '', driver: run.agentProfile.driver, model: run.agentProfile.model, permission: run.agentProfile.permission,
            mode: run.mode ?? 'oneshot', ...(run.cwd ? { cwd: run.cwd } : {}), initialPrompt: run.prompt ?? '', mcp: settings.mcp.map((m) => ({ name: m.name, url: m.url, headers: {} })), env: {},
          });
        } catch (error) {
          const failed = transition(started, 'failed', clock.now(), { error: `启动 Agent 失败：${error instanceof Error ? error.message : String(error)}` });
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
      return { ...base, kind: 'agent', mode: input.mode, prompt: input.prompt, agentProfile: profile, ...(contract ? { outputContract: contract } : {}), runnerRef: newId('agt') };
    },
  };
}
