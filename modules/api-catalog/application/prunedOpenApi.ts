import type { Actor, ServiceId } from '@crewstation/contracts';
import { PLATFORM_PATHS } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import { isCallable } from '../domain/apiOperation';
import { pruneOpenApi } from '../domain/openApiPruning';
import type { ApiCatalogUseCaseDeps } from './dependencies';

/** 工作台内嵌 Swagger 的数据源：按目标服务的可调范围裁剪，servers 指向服务域内部 API 前缀。 */
export function prunedOpenApiUseCase({ uow, services, projects, hosts }: ApiCatalogUseCaseDeps) {
  return async (actor: Actor, serviceId: ServiceId, proxyId: string): Promise<Record<string, unknown>> => {
    const resolved = await services.resolveService(serviceId);
    if (!resolved) throw notFound('服务', serviceId);
    await projects.authorize(actor, resolved.projectId, 'view');
    const proxy = await uow.read.proxies.getById(proxyId);
    if (!proxy || proxy.state !== 'active') throw notFound('代理', proxyId);
    const granted = new Set((await uow.read.grants.listGranted(serviceId)).map((g) => g.operationId));
    const allowedOperations = (await uow.read.operations.listByProxy(proxyId)).filter((op) => isCallable(op, granted));
    const serversUrl = `http://${hosts.platformApiHost()}${PLATFORM_PATHS.internalApiPrefix}${proxy.proxy}`;
    return pruneOpenApi(proxy.document, { proxy: proxy.proxy, allowedOperations, serversUrl });
  };
}
