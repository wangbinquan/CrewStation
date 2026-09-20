import type { ApiOperationDto, ApiProxyDto, ApiRequestDto } from '@crewstation/contracts';
import type { ApiOperation } from '../domain/apiOperation';
import type { ApiProxy } from '../domain/apiProxy';
import type { ApiRequest } from '../domain/apiRequest';

export function operationToDto(op: ApiOperation, granted?: boolean): ApiOperationDto {
  return {
    id: op.id, proxyId: op.proxyId,
    proxy: op.proxy,
    method: op.method,
    path: op.path,
    ...(op.summary === undefined ? {} : { summary: op.summary }),
    openPolicy: op.openPolicy,
    ...(op.resourceNote === undefined ? {} : { resourceNote: op.resourceNote }),
    ...(granted === undefined ? {} : { granted }),
  };
}

export function proxyToDto(proxy: ApiProxy, operationCount: number): ApiProxyDto {
  return {
    id: proxy.id, name: proxy.name, proxy: proxy.proxy,
    projectId: proxy.projectId,
    serviceId: proxy.serviceId,
    kind: proxy.kind,
    ...(proxy.upstreamConnection === undefined ? {} : { upstreamConnection: proxy.upstreamConnection }),
    state: proxy.state,
    operationCount,
    updatedAt: proxy.updatedAt.toISOString(),
  };
}

export function requestToDto(request: ApiRequest): ApiRequestDto {
  return {
    id: request.id,
    serviceId: request.serviceId,
    operationId: request.operationId,
    state: request.state,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    requestedBy: request.requestedBy,
    ...(request.decidedBy === undefined ? {} : { decidedBy: request.decidedBy }),
    ...(request.decision === undefined ? {} : { decision: request.decision }),
    createdAt: request.createdAt.toISOString(),
    ...(request.decidedAt === undefined ? {} : { decidedAt: request.decidedAt.toISOString() }),
  };
}
