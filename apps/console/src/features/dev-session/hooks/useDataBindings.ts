import type { RequestTaskDataBindingInput } from '@crewstation/api-client';
import type { TaskDataBindingDto } from '@crewstation/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import type { ApiClientError } from '../../../shared/api/useApi';

export interface DataBindingsHandle {
  readonly bindings: readonly TaskDataBindingDto[];
  readonly isPending: boolean;
  readonly loadError: ApiClientError | null;
  /** 项目开通链没完成时没有服务 ID，申请入口整体不可用。 */
  readonly canRequest: boolean;
  readonly request: UseMutationResult<TaskDataBindingDto, ApiClientError, RequestTaskDataBindingInput>;
}

/** 开发会话的数据访问绑定：三种模式，后两种要负责人批准。 */
export function useDataBindings(projectId: string, taskId: string, serviceId: string | undefined): DataBindingsHandle {
  const key = queryKeys.dataBindings(projectId);
  const query = useApiQuery(key, () => api.tasks.listTaskDataBindings(taskId));
  const request = useApiMutation(
    (input: RequestTaskDataBindingInput) => {
      if (serviceId === undefined) return Promise.reject(new Error('项目尚未完成开通，没有可绑定的服务'));
      return api.tasks.requestDataBinding(serviceId, taskId, input);
    },
    { invalidate: [key] },
  );
  return { bindings: query.data?.items ?? [], isPending: query.isPending, loadError: query.error, canRequest: serviceId !== undefined, request };
}
