import type { Actor, ProjectId, ServiceActor, SubmitSubtaskRequest, SubtaskDto, SubtaskId, SubtaskMessageRequest, TaskId } from '@crewstation/contracts';
import { newId, notFound, precondition } from '@crewstation/kernel';
import { acceptsSubtasks } from '../domain/businessTask';
import type { SubtaskRun } from '../domain/subtaskRun';
import { isTerminal, transition } from '../domain/subtaskRun';
import type { BusinessTaskUseCaseDeps } from './dependencies';
import { subtaskLaunch } from './subtaskLaunch';
import { subtaskRefresh } from './subtaskRefresh';
import { taskLifecycleUseCases } from './taskLifecycle';
import { subtaskToDto } from './toDto';

/** 子任务：Agent 子任务引用登记的 agentProfile/outputContract，命令子任务直接执行；并发提交互不阻塞，由业务程序协调。 */
export function subtaskUseCases(deps: BusinessTaskUseCaseDeps) {
  const { uow, runner, settings, clock } = deps;
  const { ownedTask } = taskLifecycleUseCases(deps);
  const { refresh, finish } = subtaskRefresh(deps);

  const load = async (taskId: TaskId, subtaskId: SubtaskId): Promise<SubtaskRun> => {
    const run = await uow.read.subtasks.getById(subtaskId);
    if (!run || run.taskId !== taskId) throw notFound('子任务', subtaskId);
    return run;
  };

  const { launch, build, dispatchPending } = subtaskLaunch(deps);

  return {
    dispatchPendingSubtasks: dispatchPending,
    submitSubtask: async (caller: ServiceActor, taskId: TaskId, input: SubmitSubtaskRequest): Promise<SubtaskDto> => {
      const task = await ownedTask(caller, taskId);
      if (!acceptsSubtasks(task)) throw precondition(`任务处于 ${task.state}，不能提交子任务`);
      const run = await build(task, input, 1);
      await uow.run((scope) => scope.subtasks.insert(run));
      return subtaskToDto(await launch(run));
    },
    retrySubtask: async (caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId): Promise<SubtaskDto> => {
      const task = await ownedTask(caller, taskId);
      const previous = await load(taskId, subtaskId);
      if (!isTerminal(previous)) throw precondition('只能重试已结束的子任务');
      const spec: SubmitSubtaskRequest = previous.kind === 'command'
        ? { kind: 'command', name: previous.name, command: previous.command ?? [], timeoutSeconds: previous.timeoutSeconds ?? 3600, ...(previous.cwd ? { cwd: previous.cwd } : {}) }
        : { kind: 'agent', name: previous.name, agentProfile: previous.agentProfile?.name ?? '', ...(previous.outputContract ? { outputContract: previous.outputContract.name } : {}), mode: previous.mode ?? 'oneshot', prompt: previous.prompt ?? '', ...(previous.cwd ? { cwd: previous.cwd } : {}) };
      const run = await build(task, spec, previous.attempt + 1);
      await uow.run((scope) => scope.subtasks.insert(run));
      return subtaskToDto(await launch(run));
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
      const events = await runner.listEvents(taskId, { kinds: ['agent'], agentId: run.runnerRef ?? '', limit: 5000 });
      return events.map((e) => (e.event.kind === 'agent' ? e.event.event.text ?? '' : '')).join('').slice(0, settings.outputLimitBytes);
    },
    sendSubtaskMessage: async (caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId, input: SubtaskMessageRequest): Promise<SubtaskDto> => {
      await ownedTask(caller, taskId);
      const run = await refresh(await load(taskId, subtaskId));
      if (run.kind !== 'agent' || run.mode !== 'interactive') throw precondition('只有交互模式的 Agent 子任务接受消息');
      if (isTerminal(run)) throw precondition(`子任务已 ${run.state}`);
      await runner.sendCommand(taskId, { id: `msg-${newId('m')}`, type: 'sendMessage', agentId: run.runnerRef ?? '', content: input.content });
      const running = run.state === 'awaiting-input' ? transition(run, 'running', clock.now()) : run;
      if (running !== run) await uow.run((scope) => scope.subtasks.update(running));
      return subtaskToDto(running);
    },
    cancelSubtask: async (caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId): Promise<SubtaskDto> => {
      await ownedTask(caller, taskId);
      const run = await load(taskId, subtaskId);
      if (isTerminal(run)) return subtaskToDto(run);
      await runner.sendCommand(taskId, run.kind === 'agent' ? { id: `cancel-${run.id}`, type: 'cancelAgent', agentId: run.runnerRef ?? '' } : { id: `cancel-${run.id}`, type: 'cancelExec', execId: run.runnerRef ?? '' });
      return subtaskToDto(await finish(run, transition(run, 'cancelled', clock.now())));
    },
    listProjectSubtasks: async (actor: Actor, projectId: ProjectId, taskId: TaskId): Promise<SubtaskDto[]> => {
      const task = await uow.read.tasks.getById(taskId);
      if (!task || task.projectId !== projectId) throw notFound('业务任务', taskId);
      await deps.authorizer.authorize(actor, projectId, 'view');
      return (await uow.read.subtasks.listByTask(taskId)).map(subtaskToDto);
    },
    listProjectSubtasksInternal: async (taskId: TaskId): Promise<SubtaskDto[]> => (await uow.read.subtasks.listByTask(taskId)).map(subtaskToDto),
    /** 工作器：推进仍在运行的子任务，避免只靠业务轮询。 */
    sweepActive: async (): Promise<number> => {
      let n = 0;
      for (const run of await uow.read.subtasks.listActive(200)) { const next = await refresh(run); if (next !== run) n += 1; }
      return n;
    },
  };
}
