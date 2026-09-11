import type { Actor, ApiOperationDto, ApiProxyDto, ServiceId } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import { isCallable } from '../domain/apiOperation';
import type { ApiCatalogUseCaseDeps } from './dependencies';
import { operationToDto, proxyToDto } from './toDto';

/** 目录读侧：对所有登录用户开放（工作台内嵌 Swagger 用），带 serviceId 时要求对其项目可见。 */
export function catalogQueryUseCases({ uow, services, projects }: ApiCatalogUseCaseDeps) {
  return {
    listOperations: async (actor: Actor, serviceId?: ServiceId): Promise<ApiOperationDto[]> => {
      const operations = await uow.read.operations.listActive();
      if (serviceId === undefined) return operations.map((op) => operationToDto(op));
      const resolved = await services.resolveService(serviceId);
      if (!resolved) throw notFound('服务', serviceId);
      await projects.authorize(actor, resolved.projectId, 'view');
      const granted = new Set((await uow.read.grants.listGranted(serviceId)).map((g) => g.operationKey));
      return operations.map((op) => operationToDto(op, isCallable(op, granted)));
    },
    listProxies: async (_actor: Actor): Promise<ApiProxyDto[]> => {
      const [proxies, operations] = await Promise.all([uow.read.proxies.list(), uow.read.operations.listActive()]);
      const counts = new Map<string, number>();
      for (const op of operations) counts.set(op.proxy, (counts.get(op.proxy) ?? 0) + 1);
      return proxies.map((proxy) => proxyToDto(proxy, counts.get(proxy.proxy) ?? 0));
    },
  };
}
