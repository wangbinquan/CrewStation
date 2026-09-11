import type { ItemsPage } from '@crewstation/api-client';
import type { ApiOperationDto, ApiProxyDto, ApiRequestDto } from '@crewstation/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import type { ApiClientError } from '../../../shared/api/useApi';

export interface CatalogData {
  readonly operations: UseQueryResult<ItemsPage<ApiOperationDto>, ApiClientError>;
  readonly requests: UseQueryResult<ItemsPage<ApiRequestDto>, ApiClientError>;
  readonly proxies: UseQueryResult<ItemsPage<ApiProxyDto>, ApiClientError>;
}

/**
 * 目录页的三份只读数据。
 * 操作列表带 serviceId 才会返回 granted；申请列表按 projectId 查，只看本服务自己的申请。
 */
export function useCatalogData(projectId: string, serviceId: string): CatalogData {
  return {
    operations: useApiQuery(queryKeys.operations(serviceId), () => api.apiCatalog.listOperations({ serviceId })),
    requests: useApiQuery(queryKeys.accessRequests(serviceId), () => api.apiCatalog.listRequests({ projectId })),
    proxies: useApiQuery(queryKeys.apiProxies(), () => api.apiCatalog.listProxies()),
  };
}
