import type { AgentEvent, RunnerEvent } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import type { SubtaskRun } from '../domain/subtaskRun';
import { isTerminal, outcomeOfContract, transition } from '../domain/subtaskRun';
import type { BusinessTaskUseCaseDeps } from './dependencies';

type AgentRunnerEvent = Extract<RunnerEvent, { kind: 'agent' }>;

/** 从 TaskRunner 的持久事件推进子任务状态；契约在 Agent 结束后由 TaskRunner 校验（AT-26）。 */
export function subtaskRefresh(deps: BusinessTaskUseCaseDeps) {
  const { uow, runner, settings, clock } = deps;

  const finish = async (run: SubtaskRun, next: SubtaskRun): Promise<SubtaskRun> => {
    await uow.run(async (scope) => {
      await scope.subtasks.update(next);
      if (isTerminal(next)) {
        const task = await scope.tasks.getById(run.taskId);
        await scope.events.publish(DomainTopic.subtaskFinished, { occurredAt: clock.now().toISOString(), ...(task ? { traceId: task.traceId } : {}), taskId: run.taskId, subtaskId: run.id, state: next.state as 'succeeded' | 'failed' | 'cancelled', attempt: next.attempt });
      }
    });
    return next;
  };

  const verify = async (run: SubtaskRun, patch: Partial<SubtaskRun>): Promise<SubtaskRun> => {
    if (!run.outputContract) return finish(run, transition(run, 'succeeded', clock.now(), patch));
    const verifying = transition(run, 'verifying', clock.now(), patch);
    await uow.run((scope) => scope.subtasks.update(verifying));
    try {
      const check = (await runner.sendCommand(run.taskId, { id: `verify-${run.id}`, type: 'verifyContract', subtaskId: run.id, contract: run.outputContract, ...(run.cwd ? { cwd: run.cwd } : {}) })) as SubtaskRun['contractResult'];
      const result = check ?? { ok: false, missing: [], schemaErrors: ['契约校验未返回结果'] };
      return finish(verifying, transition(verifying, outcomeOfContract(result), clock.now(), { contractResult: result, ...(result.ok ? {} : { error: `契约 ${run.outputContract.name} 未满足` }) }));
    } catch (error) {
      return finish(verifying, transition(verifying, 'failed', clock.now(), { error: `契约校验失败：${error instanceof Error ? error.message : String(error)}` }));
    }
  };

  const refreshAgent = async (run: SubtaskRun): Promise<SubtaskRun> => {
    const events = (await runner.listEvents(run.taskId, { kinds: ['agent'], agentId: run.runnerRef ?? '', limit: 5000 })).map((e) => (e.event as AgentRunnerEvent).event);
    const sessionId = [...events].reverse().find((e) => e.sessionId)?.sessionId;
    const text = events.filter((e) => e.type === 'text' && e.text).map((e) => e.text).join('').slice(0, settings.outputLimitBytes);
    const last = events[events.length - 1];
    const base: Partial<SubtaskRun> = { ...(sessionId ? { sessionId } : {}), output: text };
    if (!last) return run;
    switch (last.type as AgentEvent['type']) {
      case 'completed': return verify(run, { ...base, exitCode: last.result?.exitCode ?? 0 });
      case 'error': return finish(run, transition(run, 'failed', clock.now(), { ...base, error: last.error?.message ?? 'Agent 报错' }));
      case 'cancelled': return finish(run, transition(run, 'cancelled', clock.now(), base));
      case 'permission': return run.state === 'awaiting-input' ? run : finish(run, transition(run, 'awaiting-input', clock.now(), base));
      default: return run.state === 'awaiting-input' ? finish(run, transition(run, 'running', clock.now(), base)) : run;
    }
  };

  const refreshCommand = async (run: SubtaskRun): Promise<SubtaskRun> => {
    const exited = (await runner.listEvents(run.taskId, { kinds: ['execExited'], limit: 5000 })).map((e) => e.event).find((e): e is Extract<RunnerEvent, { kind: 'execExited' }> => e.kind === 'execExited' && e.execId === run.runnerRef);
    if (!exited) return run;
    const exitCode = exited.exitCode ?? -1;
    return finish(run, transition(run, exitCode === 0 ? 'succeeded' : 'failed', clock.now(), { exitCode, ...(exitCode === 0 ? {} : { error: `命令退出码 ${exitCode}` }) }));
  };

  return {
    refresh: async (run: SubtaskRun): Promise<SubtaskRun> => {
      if (isTerminal(run) || run.state === 'pending' || run.state === 'verifying') return run;
      return run.kind === 'agent' ? refreshAgent(run) : refreshCommand(run);
    },
    finish,
  };
}
