import type { Actor, ProjectId, ServiceActor, SubmitSubtaskRequest, SubtaskDto, SubtaskId, SubtaskMessageRequest, TaskId } from '@crewstation/contracts';
import { newId, notFound, precondition } from '@crewstation/kernel';
import { acceptsSubtasks } from '../domain/businessTask';
import type { SubtaskRun } from '../domain/subtaskRun';
import { isTerminal, runnerTaskOf, transition } from '../domain/subtaskRun';
import type { BusinessTaskUseCaseDeps } from './dependencies';
import { subtaskLaunch } from './subtaskLaunch';
import { subtaskRefresh } from './subtaskRefresh';
import { subtaskSweep } from './subtaskSweep';
import { taskLifecycleUseCases } from './taskLifecycle';
import { subtaskToDto } from './toDto';

/** 子任务：Agent 子任务引用登记的 agentProfile/outputContract，命令子任务直接执行；并发提交互不阻塞，由业务程序协调。 */
export function subtaskUseCases(deps: BusinessTaskUseCaseDeps) {
  const { uow, runner, settings, clock } = deps;
  const { ownedTask } = taskLifecycleUseCases(deps);
  const { refresh, finish, releaseExecution } = subtaskRefresh(deps);

  const { launch, build, dispatchPending } = subtaskLaunch(deps), load = loadSubtask(deps);

  return {
    dispatchPendingSubtasks: dispatchPending,
    submitSubtask: async (caller: ServiceActor, taskId: TaskId, input: SubmitSubtaskRequest): Promise<SubtaskDto> => {
      const task = await ownedTask(caller, taskId);
      if (!acceptsSubtasks(task)) throw precondition(`任务处于 ${task.state}，不能提交子任务`);
      const run = await build(task, input, 1);
      await uow.run((scope) => scope.subtasks.insert(run));
      return subtaskToDto(await launch(run));
    },
    retrySubtask: async (caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId, operationId?: string): Promise<SubtaskDto> => {
      const task = await ownedTask(caller, taskId);
      const accepted = operationId ? await uow.read.subtasks.findRetry(taskId, operationId) : undefined;
      if (accepted) {
        if (accepted.retry?.previousId !== subtaskId) throw precondition('重试操作已用于不同的子任务');
        return subtaskToDto(accepted);
      }
      const previous = await load(taskId, subtaskId);
      if (!isTerminal(previous)) throw precondition('只能重试已结束的子任务');
      const spec: SubmitSubtaskRequest = previous.kind === 'command'
        ? { kind: 'command', name: previous.name, command: previous.command ?? [], timeoutSeconds: previous.timeoutSeconds ?? 3600, ...(previous.cwd ? { cwd: previous.cwd } : {}) }
        : { kind: 'agent', name: previous.name, agentProfileId: previous.agentProfile?.id ?? '', ...(previous.outputContract ? { outputContractId: previous.outputContract.id } : {}), mode: previous.mode ?? 'oneshot', prompt: previous.prompt ?? '', ...(previous.cwd ? { cwd: previous.cwd } : {}) };
      const built = await build(task, spec, previous.attempt + 1);
      if (operationId) {
        const accepted = await uow.run((scope) => scope.subtasks.reserveRetry({ ...built, retry: { operationId, previousId: subtaskId } }));
        return subtaskToDto(accepted.created ? await launch(accepted.run) : accepted.run);
      }
      await uow.run((scope) => scope.subtasks.insert(built));
      return subtaskToDto(await launch(built));
    },
    getSubtask: async (caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId): Promise<SubtaskDto> => {
      await ownedTask(caller, taskId);
      return subtaskToDto(await refresh(await load(taskId, subtaskId)));
    },
    listSubtasks: async (caller: ServiceActor, taskId: TaskId): Promise<SubtaskDto[]> => {
      await ownedTask(caller, taskId);
      return Promise.all((await uow.read.subtasks.listByTask(taskId)).map(async (r) => subtaskToDto(await refresh(r))));
    },
    subtaskOutput: async (caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId): Promise<string> => {
      await ownedTask(caller, taskId);
      const run = await refresh(await load(taskId, subtaskId));
      if (run.output !== undefined) return run.output;
      if (run.kind !== 'agent') return '';
      const events = await runner.listEvents(runnerTaskOf(run), { kinds: ['agent'], agentId: run.runnerRef ?? '', limit: 5000 });
      return events.map((e) => (e.event.kind === 'agent' ? e.event.event.text ?? '' : '')).join('').slice(0, settings.outputLimitBytes);
    },
    sendSubtaskMessage: async (caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId, input: SubtaskMessageRequest): Promise<SubtaskDto> => {
      await ownedTask(caller, taskId);
      const run = await refresh(await load(taskId, subtaskId));
      if (run.kind !== 'agent' || run.mode !== 'interactive') throw precondition('只有交互模式的 Agent 子任务接受消息');
      if (isTerminal(run)) throw precondition(`子任务已 ${run.state}`);
      if (run.state === 'pending') throw precondition('子任务尚未开始执行（执行环境准备中），请稍后再发消息');
      await runner.sendCommand(runnerTaskOf(run), { id: `msg-${newId('m')}`, type: 'sendMessage', agentId: run.runnerRef ?? '', content: input.content });
      const running = run.state === 'awaiting-input' ? transition(run, 'running', clock.now()) : run;
      if (running !== run) await uow.run((scope) => scope.subtasks.update(running));
      return subtaskToDto(running);
    },
    cancelSubtask: async (caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId): Promise<SubtaskDto> => {
      await ownedTask(caller, taskId);
      const run = await load(taskId, subtaskId);
      if (isTerminal(run)) return subtaskToDto(run);
      // 还没派发的子任务没有进程可取消：直接结束，执行环境随 finish 回收。
      if (run.state !== 'pending') {
        await runner.sendCommand(runnerTaskOf(run), run.kind === 'agent' ? { id: `cancel-${run.id}`, type: 'cancelAgent', agentId: run.runnerRef ?? '' } : { id: `cancel-${run.id}`, type: 'cancelExec', execId: run.runnerRef ?? '' });
      }
      return subtaskToDto(await finish(run, transition(run, 'cancelled', clock.now())));
    },
    listProjectSubtasks: async (actor: Actor, projectId: ProjectId, taskId: TaskId): Promise<SubtaskDto[]> => {
      const task = await uow.read.tasks.getById(taskId);
      if (!task || task.projectId !== projectId) throw notFound('业务任务', taskId);
      await deps.authorizer.authorize(actor, projectId, 'view');
      return (await uow.read.subtasks.listByTask(taskId)).map(subtaskToDto);
    },
    listProjectSubtasksInternal: async (taskId: TaskId): Promise<SubtaskDto[]> => (await uow.read.subtasks.listByTask(taskId)).map(subtaskToDto),
    sweepActive: subtaskSweep(deps, { refresh, launch, releaseExecution }),
  };
}

function loadSubtask(deps: BusinessTaskUseCaseDeps) {
  return async (taskId: TaskId, subtaskId: SubtaskId): Promise<SubtaskRun> => {
    const run = await deps.uow.read.subtasks.getById(subtaskId);
    if (!run || run.taskId !== taskId) throw notFound("子任务", subtaskId);
    return run;
  };
}
