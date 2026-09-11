import type { ApiOperationDto, ApiRequestDto, CreateApiRequest, DecideApiRequest, OpenPolicy } from '@crewstation/contracts';
import type { QueryKey, UseMutationResult } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation } from '../../../shared/api/useApi';
import type { ApiClientError } from '../../../shared/api/useApi';

export type DecideInput = DecideApiRequest & { readonly id: string };
export type SetPolicyInput = { readonly operationKey: string; readonly openPolicy: OpenPolicy };

export interface CatalogActions {
  readonly requestAccess: UseMutationResult<ApiRequestDto, ApiClientError, CreateApiRequest>;
  readonly setPolicy: UseMutationResult<ApiOperationDto, ApiClientError, SetPolicyInput>;
  readonly decide: UseMutationResult<ApiRequestDto, ApiClientError, DecideInput>;
  readonly revokeGrant: UseMutationResult<void, ApiClientError, string>;
}

/**
 * 目录页的四个写操作。开放策略、审批与撤销都会改变 granted，
 * 因此统一按 operations／access-requests 两个前缀失效，不逐条改缓存。
 */
export function useCatalogActions(serviceId: string): CatalogActions {
  const invalidate: readonly QueryKey[] = [queryKeys.operations(), queryKeys.accessRequests()];
  return {
    requestAccess: useApiMutation((input: CreateApiRequest) => api.apiCatalog.requestAccess(serviceId, input), { invalidate }),
    setPolicy: useApiMutation(({ operationKey, openPolicy }: SetPolicyInput) => api.apiCatalog.setOpenPolicy(operationKey, { openPolicy }), { invalidate }),
    decide: useApiMutation(({ id, ...decision }: DecideInput) => api.apiCatalog.decideRequest(id, decision), { invalidate }),
    revokeGrant: useApiMutation((operationKey: string) => api.apiCatalog.revokeGrant(serviceId, operationKey), { invalidate }),
  };
}
