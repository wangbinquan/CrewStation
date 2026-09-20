import type { ProjectId, RequestPageQuery, ServiceId } from '@crewstation/contracts';
import type { ApiGrant } from '../domain/apiGrant';
import type { ApiOperation } from '../domain/apiOperation';
import type { ApiProxy } from '../domain/apiProxy';
import type { ApiRequest } from '../domain/apiRequest';

export interface ApiProxyRepository {
  upsert(proxy: ApiProxy): Promise<void>;
  getByCode(code: string): Promise<ApiProxy | undefined>;
  getById(id: string): Promise<ApiProxy | undefined>;
  listByService(serviceId: ServiceId): Promise<ApiProxy[]>;
  list(): Promise<ApiProxy[]>;
}

export interface ApiOperationRepository {
  /** 含 removed 的全部操作，供对齐时保留开放策略。 */
  listByProxy(proxy: string): Promise<ApiOperation[]>;
  listActive(): Promise<ApiOperation[]>;
  getById(key: string): Promise<ApiOperation | undefined>;
  upsertMany(operations: readonly ApiOperation[]): Promise<void>;
  update(operation: ApiOperation): Promise<void>;
}

export interface ApiGrantRepository {
  get(serviceId: ServiceId, operationId: string): Promise<ApiGrant | undefined>;
  listGranted(serviceId: ServiceId): Promise<ApiGrant[]>;
  upsert(grant: ApiGrant): Promise<void>;
}

export interface ApiRequestRepository {
  insert(request: ApiRequest): Promise<void>;
  update(request: ApiRequest): Promise<void>;
  getById(id: string): Promise<ApiRequest | undefined>;
  findPending(serviceId: ServiceId, operationId: string): Promise<ApiRequest | undefined>;
  /** 不给 projectId 时列出全部；按创建时间倒序。 */
  list(projectId?: ProjectId): Promise<ApiRequest[]>;
  listPage(query: Pick<RequestPageQuery, 'projectId' | 'state'> & { limit: number; before?: { createdAt: Date; id: string } }): Promise<ApiRequest[]>;
}
