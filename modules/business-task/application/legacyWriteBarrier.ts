import { AsyncLocalStorage } from 'node:async_hooks';
import type { ServiceActor, TaskId } from '@crewstation/contracts';
import { forbidden, isPlatformError, jsonHash, newResourceId, notFound } from '@crewstation/kernel';
import type { BusinessTaskModuleApi } from '../api/moduleApi';
import type { LegacyMutations, LegacyMutationTicket } from '../ports/legacyMutations';
import type { BusinessTaskUseCaseDeps } from './dependencies';
import { isTerminal } from '../domain/subtaskRun';

const requestScope = new AsyncLocalStorage<LegacyMutationTicket>();
type LegacyWriteApi = Pick<BusinessTaskModuleApi, 'createTask' | 'closeTask' | 'pauseTask' | 'resumeTask' | 'submitSubtask' | 'retrySubtask' | 'sendSubtaskMessage' | 'cancelSubtask'>;

/** Request tickets protect local acceptance too; each outbound effect has its own independent ticket. */
export function legacyWriteApi(api: LegacyWriteApi, deps: BusinessTaskUseCaseDeps, barrier: LegacyMutations): LegacyWriteApi {
  const run = async <T>(caller: ServiceActor, kind: string, taskId: TaskId | undefined, action: () => Promise<T>): Promise<T> => {
    const service = await deps.directory.resolveServiceIdentity(caller.identity);
    if (!service) throw forbidden('未登记的服务身份');
    const ticket = await barrier.begin({ serviceId: service.serviceId, kind, ...(taskId ? { taskId } : {}) });
    try { return await requestScope.run(ticket, action); } finally { await barrier.settle(ticket, 'complete'); }
  };
  return {
    createTask: (caller, input) => run(caller, 'create-task-request', undefined, () => api.createTask(caller, input)),
    closeTask: (caller, id) => run(caller, 'close-task-request', id, () => api.closeTask(caller, id)),
    pauseTask: (caller, id) => run(caller, 'pause-task-request', id, () => api.pauseTask(caller, id)),
    resumeTask: (caller, id) => run(caller, 'resume-task-request', id, () => api.resumeTask(caller, id)),
    submitSubtask: (caller, id, input) => run(caller, 'submit-subtask-request', id, () => api.submitSubtask(caller, id, input)),
    retrySubtask: (caller, id, sub) => run(caller, 'retry-subtask-request', id, () => api.retrySubtask(caller, id, sub)),
    sendSubtaskMessage: (caller, id, sub, input) => run(caller, 'message-subtask-request', id, () => api.sendSubtaskMessage(caller, id, sub, input)),
    cancelSubtask: (caller, id, sub) => run(caller, 'cancel-subtask-request', id, () => api.cancelSubtask(caller, id, sub)),
  };
}

/** Covers background launch and detached exec promises as well as writes made by an HTTP request. */
export function legacyRuntimePorts(deps: BusinessTaskUseCaseDeps, barrier: LegacyMutations): BusinessTaskUseCaseDeps {
  const serviceOf = async (taskId: TaskId): Promise<string> => {
    const native = await deps.uow.read.subtasks.findByExecution(taskId);
    const task = await deps.uow.read.tasks.getById(native?.taskId ?? taskId);
    if (!task) throw notFound('业务任务', taskId);
    return task.serviceId;
  };
  const effect = async <T>(serviceId: string, kind: string, taskId: TaskId | undefined, action: () => Promise<T>): Promise<T> => {
    const ticket = await barrier.begin({ serviceId, kind, ...(taskId ? { taskId } : {}), ...(requestScope.getStore() ? { parentId: requestScope.getStore()!.id } : {}) });
    try {
      const result = await action();
      await barrier.settle(ticket, 'complete');
      return result;
    } catch (error) {
      // A timeout is not proof that a remote effect never happened. No lease expiry clears this ticket.
      const rejected = isPlatformError(error) && (['quota_exceeded', 'validation', 'forbidden', 'not_found'].includes(error.kind) || ['unsupported_capability', 'protocol_unsupported', 'interpreter_unavailable'].includes(String(error.details?.code)));
      await barrier.settle(ticket, rejected ? 'complete' : 'unknown');
      throw error;
    }
  };
  const taskEffect = async <T>(id: TaskId, kind: string, action: () => Promise<T>) => effect(await serviceOf(id), kind, id, action);
  const release: BusinessTaskUseCaseDeps['environments']['releaseEnvironment'] = async (id, reason) => {
    const finished = await deps.uow.read.subtasks.findByExecution(id);
    // Cleanup of a proved terminal execution continues across a handoff; it cannot start another node.
    if (finished && isTerminal(finished)) return deps.environments.releaseEnvironment(id, reason);
    return taskEffect(id, 'release-environment', () => deps.environments.releaseEnvironment(id, reason));
  };
  return { ...deps,
    uow: { ...deps.uow, run: (run) => { const ticket = requestScope.getStore(); return ticket ? barrier.local(ticket, run) : deps.uow.run(run); } },
    legacyDispatch: async (id, run) => {
      let ticket;
      try { ticket = await barrier.begin({ serviceId: await serviceOf(id), kind: 'launch-request', taskId: id, ...(requestScope.getStore() ? { parentId: requestScope.getStore()!.id } : {}) }); }
      catch (error) { if (isPlatformError(error) && error.details?.code === 'execution_fence_required') return undefined; throw error; }
      try { return await requestScope.run(ticket, run); } finally { await barrier.settle(ticket, 'complete'); }
    },
    environments: {
      ...deps.environments,
      createEnvironment: (input) => {
        if (!input.admission && !deps.settings.legacyFixedAdmission) return effect(input.serviceId, 'create-environment', undefined, () => deps.environments.createEnvironment(input));
        const admission = input.admission ?? { id: newResourceId() as TaskId, fingerprint: jsonHash(input) };
        return effect(input.serviceId, 'create-environment', admission.id, () => deps.environments.createEnvironment({ ...input, admission }));
      },
      createNativeExecution: async (input) => effect(await serviceOf(input.parentTaskId), 'create-native-execution', input.id, () => deps.environments.createNativeExecution(input)),
      releaseEnvironment: release,
      pauseEnvironment: (id) => taskEffect(id, 'pause-environment', () => deps.environments.pauseEnvironment(id)),
      resumeEnvironment: (id) => taskEffect(id, 'resume-environment', () => deps.environments.resumeEnvironment(id)),
    },
    runner: { ...deps.runner, sendCommand: (id, command) => command.type === 'verifyContract' ? deps.runner.sendCommand(id, command) : taskEffect(id, `runner:${command.type}`, () => deps.runner.sendCommand(id, command)) },
  };
}
