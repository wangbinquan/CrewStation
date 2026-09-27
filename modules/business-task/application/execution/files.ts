import { BusinessDirectoryDtoSchema, BusinessDirectoryQuerySchema, BusinessFileDtoSchema, BusinessFileQuerySchema } from '@crewstation/contracts';
import type { TaskId } from '@crewstation/contracts';
import { conflict, isPlatformError, newResourceId, notFound, PlatformError, precondition } from '@crewstation/kernel';
import type { BusinessExecutionApi, BusinessExecutionCaller } from '../../api/executionApi';
import type { BusinessExecutionDeps } from './dependencies';
import { executionSource } from './source';

/** Reads are allowed from either slot, but only after validating the same service ownership as task queries. */
export function executionFileUseCases(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'readFile' | 'listFiles'> {
  const source = executionSource(deps);
  const readable = async (caller: BusinessExecutionCaller, taskId: TaskId): Promise<void> => {
    const context = await source(caller), operation = await deps.operations.forTask(context.serviceId, taskId);
    if (!operation) throw notFound('业务任务', taskId);
    const environment = await deps.environments.getEnvironment(taskId);
    if (environment?.state === 'paused') throw conflict('任务已暂停，不能读取工作区文件', { code: 'task_paused' });
    if (operation.state !== 'succeeded' || !environment || environment.state !== 'running' || !environment.connected) throw precondition('任务工作区当前不可读取', { code: 'workspace_unavailable' });
  };
  return {
    readFile: async (caller, taskId, input) => {
      const query = BusinessFileQuerySchema.parse(input);
      await readable(caller, taskId);
      return BusinessFileDtoSchema.parse(await deps.runner.sendCommand(taskId, { id: newResourceId(), type: 'readBusinessFile', query }).catch(fileFailure));
    },
    listFiles: async (caller, taskId, input) => {
      const query = BusinessDirectoryQuerySchema.parse(input);
      await readable(caller, taskId);
      return BusinessDirectoryDtoSchema.parse(await deps.runner.sendCommand(taskId, { id: newResourceId(), type: 'listBusinessFiles', query }).catch(fileFailure));
    },
  };
}

function fileFailure(error: unknown): never {
  if (isPlatformError(error)) {
    const code = error.details?.code;
    const kind = code === 'file_version_changed' ? 'conflict' : code === 'path_denied' ? 'forbidden' : code === 'not_found' ? 'not_found' : ['invalid_cursor', 'invalid_offset', 'invalid_file_type'].includes(String(code)) ? 'validation' : undefined;
    if (kind) throw new PlatformError(kind, error.message, error.details);
  }
  throw error;
}
