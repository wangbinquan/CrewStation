import type { ItemsPage } from '@crewstation/api-client';
import type { ApiOperationDto, ApiProxyDto, ApiRequestDto } from '@crewstation/contracts';
import type { QueryKey, UseQueryResult } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import type { ApiClientError } from '../../../shared/api/useApi';

/** 代理清单没有专属的共享键；挂在 operations 前缀下，授权变化时一次失效即可连带刷新。 */
export function proxiesKey(): QueryKey {
  return [...queryKeys.operations(), 'proxies'];
}

/** 裁剪后的 OpenAPI 按“服务＋代理”缓存：同一代理对不同服务裁剪结果不同，不能只用代理名做键。 */
export function openapiKey(serviceId: string, proxy: string): QueryKey {
  return queryKeys.operationSpec(`${serviceId}/${proxy}`);
}

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
    proxies: useApiQuery(proxiesKey(), () => api.apiCatalog.listProxies()),
  };
}
