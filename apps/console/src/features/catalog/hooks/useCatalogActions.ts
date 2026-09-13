import type { ApiRequestDto, CreateApiRequest } from '@crewstation/contracts';
import type { QueryKey, UseMutationResult } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation } from '../../../shared/api/useApi';
import type { ApiClientError } from '../../../shared/api/useApi';

export interface CatalogActions {
  readonly requestAccess: UseMutationResult<ApiRequestDto, ApiClientError, CreateApiRequest>;
}

/** 项目消费页只提交本服务的申请；平台策略、审批与撤销由管理空间提供。 */
export function useCatalogActions(serviceId: string): CatalogActions {
  const invalidate: readonly QueryKey[] = [queryKeys.operations(), queryKeys.accessRequests()];
  return {
    requestAccess: useApiMutation((input: CreateApiRequest) => api.apiCatalog.requestAccess(serviceId, input), { invalidate }),
  };
}
