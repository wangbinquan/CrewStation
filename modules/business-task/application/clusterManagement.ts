import type { Actor, ClusterOperation, ClusterResource, ClusterInspectRequest, ServiceActor, TaskId, SubtaskId } from '@crewstation/contracts';
import { forbidden, notFound, precondition } from '@crewstation/kernel';
import type { ClusterCommands } from '../ports/clusterCommands';
import type { BusinessTaskUseCaseDeps } from './dependencies';
import { taskLifecycleUseCases } from './taskLifecycle';
import { subtaskUseCases } from './subtasks';
export function businessClusterUseCases(deps: BusinessTaskUseCaseDeps, commands: ClusterCommands) {
  const tasks = taskLifecycleUseCases(deps), subtasks = subtaskUseCases(deps);
  const resolve = async (actor: Actor, target: ClusterResource) => {
    if (!actor.isAdmin) throw forbidden();
    const subtask = target.purpose === 'business-subtask' ? await deps.uow.read.subtasks.findByExecution(target.taskId as TaskId) : undefined;
    const task = await deps.uow.read.tasks.getById(subtask?.taskId ?? target.taskId as TaskId);
    if (!task) throw notFound('业务任务', target.taskId);
    const [project = '', service = ''] = task.callerIdentity.split('/');
    const caller: ServiceActor = { identity: task.callerIdentity, project, service };
    return { task, subtask, caller };
  };
  return {
    inspectClusterTask: async (actor: Actor, target: ClusterResource, request: ClusterInspectRequest) => {
      const { task, subtask } = await resolve(actor, target);
      if (request.action === 'restart') {
        if (subtask && !['failed', 'cancelled'].includes(subtask.state)) throw precondition('只允许重试失败或已取消的业务子任务，成功业务不会重复执行');
        if (!subtask && (task.volumeMode !== 'persistent' || !['running', 'paused'].includes(task.state))) throw precondition('仅持久卷模式的运行中或暂停业务工作区支持重启');
      }
      return { taskId: task.id, state: task.state, volumeMode: task.volumeMode, ...(subtask ? { subtaskId: subtask.id, subtaskState: subtask.state, attempt: subtask.attempt } : {}) };
    },
    executeClusterTask: async (actor: Actor, operation: ClusterOperation) => {
      const { task, subtask, caller } = await resolve(actor, operation.target);
      return commands.withLock(task.id, async () => {
        let record = await commands.get(operation.operationId);
        if (record?.phase === 'applied') return { operationId: record.resultId! };
        record ??= { operation, phase: 'prepared' }; await commands.save(record);
        let resultId: string = task.id;
        if (subtask) {
          if (operation.action === 'restart') resultId = (await subtasks.retrySubtask(caller, task.id, subtask.id, operation.operationId)).id;
          else await subtasks.cancelSubtask(caller, task.id, subtask.id);
        } else if (operation.action === 'delete') await tasks.closeTask(caller, task.id);
        else {
          const current = await deps.uow.read.tasks.getById(task.id), env = await deps.environments.getEnvironment(task.id);
          if (record.phase === 'prepared') {
            if (current?.state !== 'paused' && env?.state !== 'paused') await tasks.pauseTask(caller, task.id);
            else if (current?.state !== 'paused') await deps.uow.run((s) => s.tasks.update({ ...current!, state: 'paused', updatedAt: deps.clock.now() }));
            record = { ...record, phase: 'paused' }; await commands.save(record);
          }
          const latest = await deps.environments.getEnvironment(task.id);
          if (latest?.state === 'paused') await tasks.resumeTask(caller, task.id);
        }
        await commands.save({ ...record, phase: 'applied', resultId }); return { operationId: resultId };
      });
    },
    observeClusterTask: async (operation: ClusterOperation) => {
      const record = await commands.get(operation.operationId); if (!record?.resultId) return { done: false, reason: '等待业务流程受理' };
      if (operation.target.purpose === 'business-subtask' && operation.action === 'restart') {
        const run = await deps.uow.read.subtasks.getById(record.resultId as SubtaskId);
        return { done: !!run && run.state !== 'pending', failed: run?.state === 'failed', reason: run?.error ?? `业务重试状态：${run?.state ?? 'unknown'}` };
      }
      const env = await deps.environments.getEnvironment(operation.target.taskId as TaskId);
      const done = operation.action === 'delete' ? !env || env.state === 'released' : env?.state === 'running' && env.connected;
      return { done, reason: done ? '业务生命周期操作已完成' : env?.message ?? '等待业务环境状态收敛' };
    },
  };
}
