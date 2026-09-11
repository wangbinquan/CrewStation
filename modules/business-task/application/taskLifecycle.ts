import type { Actor, BusinessTaskDto, CreateBusinessTaskRequest, ProjectId, ServiceActor, TaskId, TraceId } from '@crewstation/contracts';
import { forbidden, notFound } from '@crewstation/kernel';
import type { BusinessTask } from '../domain/businessTask';
import { transition } from '../domain/businessTask';
import type { BusinessTaskUseCaseDeps } from './dependencies';
import { taskToDto } from './toDto';

/** 业务任务只属于创建它的服务身份；用户只能查看所在项目的任务。 */
export function taskLifecycleUseCases(deps: BusinessTaskUseCaseDeps) {
  const { uow, environments, directory, authorizer, clock } = deps;

  const ownedTask = async (caller: ServiceActor, taskId: TaskId): Promise<BusinessTask> => {
    const task = await uow.read.tasks.getById(taskId);
    if (!task) throw notFound('业务任务', taskId);
    if (task.callerIdentity !== caller.identity) throw forbidden('该任务不属于当前服务');
    return task;
  };

  return {
    ownedTask,
    createTask: async (caller: ServiceActor, input: CreateBusinessTaskRequest): Promise<BusinessTaskDto> => {
      const svc = await directory.resolveServiceIdentity(caller.identity);
      if (!svc) throw forbidden(`未登记的服务身份 ${caller.identity}`);
      const env = await environments.createEnvironment({ serviceId: svc.serviceId, kind: 'business', ...(input.volumeMode ? { volumeMode: input.volumeMode } : {}), ...(input.profile ? { profile: input.profile } : {}), ...(input.traceId ? { traceId: input.traceId } : {}), labels: { 'crewstation.io/project': caller.project, 'crewstation.io/service': caller.service, ...input.labels } });
      const now = clock.now();
      const task: BusinessTask = { id: env.id, serviceId: svc.serviceId, projectId: svc.projectId, callerIdentity: caller.identity, state: 'creating', traceId: env.traceId as TraceId, volumeMode: input.volumeMode ?? 'follow-container', profile: input.profile ?? 'default', labels: input.labels, createdAt: now, updatedAt: now };
      await uow.run((scope) => scope.tasks.insert(task));
      return taskToDto(task, env.podName);
    },
    getTask: async (caller: ServiceActor, taskId: TaskId): Promise<BusinessTaskDto> => {
      const task = await ownedTask(caller, taskId);
      const env = await environments.getEnvironment(taskId);
      const synced = env && env.state === 'running' && task.state === 'creating' ? transition(task, 'running', clock.now()) : env && env.state === 'failed' && task.state !== 'failed' && task.state !== 'closed' ? transition(task, 'failed', clock.now(), { message: '容器失败' }) : task;
      if (synced !== task) await uow.run((scope) => scope.tasks.update(synced));
      return taskToDto(synced, env?.podName);
    },
    closeTask: async (caller: ServiceActor, taskId: TaskId): Promise<BusinessTaskDto> => {
      const task = await ownedTask(caller, taskId);
      if (task.state === 'closed') return taskToDto(task);
      const closing = transition(task, 'closing', clock.now());
      await uow.run((scope) => scope.tasks.update(closing));
      await environments.releaseEnvironment(taskId, 'business');
      const closed = transition(closing, 'closed', clock.now(), { closedAt: clock.now() });
      await uow.run((scope) => scope.tasks.update(closed));
      return taskToDto(closed);
    },
    pauseTask: async (caller: ServiceActor, taskId: TaskId): Promise<BusinessTaskDto> => {
      const task = await ownedTask(caller, taskId);
      await environments.pauseEnvironment(taskId);
      const paused = transition(task, 'paused', clock.now());
      await uow.run((scope) => scope.tasks.update(paused));
      return taskToDto(paused);
    },
    resumeTask: async (caller: ServiceActor, taskId: TaskId): Promise<BusinessTaskDto> => {
      const task = await ownedTask(caller, taskId);
      const env = await environments.resumeEnvironment(taskId);
      const resumed = transition(task, 'creating', clock.now());
      await uow.run((scope) => scope.tasks.update(resumed));
      return taskToDto(resumed, env.podName);
    },
    listProjectTasks: async (actor: Actor, projectId: ProjectId): Promise<BusinessTaskDto[]> => {
      await authorizer.authorize(actor, projectId, 'view');
      return (await uow.read.tasks.listByProject(projectId, 100)).map((t) => taskToDto(t));
    },
  };
}
