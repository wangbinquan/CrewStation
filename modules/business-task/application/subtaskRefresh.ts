import type { AgentEvent, RunnerEvent } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { isPlatformError } from '@crewstation/kernel';
import type { SubtaskRun } from '../domain/subtaskRun';
import { isTerminal, outcomeOfContract, runnerTaskOf, transition } from '../domain/subtaskRun';
import type { BusinessTaskUseCaseDeps } from './dependencies';

type AgentRunnerEvent = Extract<RunnerEvent, { kind: 'agent' }>;

/** 从 TaskRunner 的持久事件推进子任务状态；契约在 Agent 结束后由 TaskRunner 校验（AT-26）。`awaiting`：本进程还在等结果的 exec（见 subtaskLaunch）。 */
export function subtaskRefresh(deps: BusinessTaskUseCaseDeps, awaiting: ReadonlySet<string> = new Set()) {
  const { uow, runner, environments, settings, clock, logger } = deps;

  /** 子任务结束后把它的执行环境交给 task-runtime 回收（Pod 与额度）；回执丢失由工作器按 released 标记重试。 */
  const releaseExecution = async (run: SubtaskRun): Promise<SubtaskRun> => {
    if (!run.execution || run.execution.released) return run;
    try { await environments.releaseEnvironment(run.execution.taskId, 'business'); }
    catch (error) {
      if (!isPlatformError(error) || error.kind !== 'not_found') { logger.warn('subtask execution release will retry', { subtaskId: run.id, error: String(error) }); return run; }
    }
    const released: SubtaskRun = { ...run, execution: { ...run.execution, released: true } };
    await uow.run((scope) => scope.subtasks.update(released));
    return released;
  };

  const finish = async (run: SubtaskRun, next: SubtaskRun): Promise<SubtaskRun> => {
    await uow.run(async (scope) => {
      await scope.subtasks.update(next);
      if (isTerminal(next)) {
        const task = await scope.tasks.getById(run.taskId);
        await scope.events.publish(DomainTopic.subtaskFinished, { occurredAt: clock.now().toISOString(), ...(task ? { traceId: task.traceId } : {}), taskId: run.taskId, subtaskId: run.id, state: next.state as 'succeeded' | 'failed' | 'cancelled', attempt: next.attempt });
      }
    });
    return isTerminal(next) ? releaseExecution(next) : next;
  };

  const verify = async (run: SubtaskRun, patch: Partial<SubtaskRun>): Promise<SubtaskRun> => {
    if (!run.outputContract) return finish(run, transition(run, 'succeeded', clock.now(), patch));
    const verifying = transition(run, 'verifying', clock.now(), patch);
    await uow.run((scope) => scope.subtasks.update(verifying));
    try {
      // 契约在子 Runner 里校验（与 Agent 同一工作卷，RFC-006 §5.4）；老子任务仍由业务任务容器校验。
      const check = (await runner.sendCommand(runnerTaskOf(run), { id: `verify-${run.id}`, type: 'verifyContract', subtaskId: run.id, contract: run.outputContract, ...(run.cwd ? { cwd: run.cwd } : {}) })) as SubtaskRun['contractResult'];
      const result = check ?? { ok: false, missing: [], schemaErrors: ['契约校验未返回结果'] };
      return finish(verifying, transition(verifying, outcomeOfContract(result), clock.now(), { contractResult: result, ...(result.ok ? {} : { error: `契约 ${run.outputContract.name} 未满足` }) }));
    } catch (error) {
      return finish(verifying, transition(verifying, 'failed', clock.now(), { error: `契约校验失败：${error instanceof Error ? error.message : String(error)}` }));
    }
  };

  const refreshAgent = async (run: SubtaskRun): Promise<SubtaskRun> => {
    const events = (await runner.listEvents(runnerTaskOf(run), { kinds: ['agent'], agentId: run.runnerRef ?? '', limit: 5000 })).map((e) => (e.event as AgentRunnerEvent).event);
    const sessionId = [...events].reverse().find((e) => e.sessionId)?.sessionId;
    const text = events.filter((e) => e.type === 'text' && e.text).map((e) => e.text).join('').slice(0, settings.outputLimitBytes);
    const last = events[events.length - 1];
    const base: Partial<SubtaskRun> = { ...(sessionId ? { sessionId } : {}), output: text };
    if (!last || !['completed', 'error', 'cancelled'].includes(last.type)) {
      // 执行环境在 Agent 结束前就没了（业务任务暂停、Pod 丢失）：子任务按失败收尾，原因取执行环境的说明（P7）。
      const env = run.execution ? await environments.getEnvironment(run.execution.taskId) : undefined;
      if (run.execution && (!env || (env.native && ['cleaning', 'finished'].includes(env.native.state)))) {
        return finish(run, transition(run, 'failed', clock.now(), { ...base, error: env?.native?.failureReason ?? env?.message ?? '子任务的执行环境已结束' }));
      }
    }
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
    // 本进程还在等 exec 的结果（带输出）时由它收尾：退出事件常先于结果落下，按事件收尾拿不到输出，
    // 抢先结成终态会让随后带着输出的收尾直接放弃（2026-09-24 CI 实撞：succeeded 而输出为空）。只有等结果的进程不在了才按事件收尾。
    if (run.runnerRef && awaiting.has(run.runnerRef)) return run;
    const exited = (await runner.listEvents(run.taskId, { kinds: ['execExited'], limit: 5000 })).map((e) => e.event).find((e): e is Extract<RunnerEvent, { kind: 'execExited' }> => e.kind === 'execExited' && e.execId === run.runnerRef);
    if (!exited) return run;
    const exitCode = exited.exitCode ?? -1;
    return finish(run, transition(run, exitCode === 0 ? 'succeeded' : 'failed', clock.now(), { exitCode, ...(exitCode === 0 ? {} : { error: `命令退出码 ${exitCode}` }) }));
  };

  return {
    releaseExecution,
    refresh: async (run: SubtaskRun): Promise<SubtaskRun> => {
      if (isTerminal(run) || run.state === 'pending' || run.state === 'verifying') return run;
      return run.kind === 'agent' ? refreshAgent(run) : refreshCommand(run);
    },
    finish,
  };
}
