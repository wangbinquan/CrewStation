import type { Actor, ApiOperationDto, ApiProxyDto, ServiceId } from '@crewstation/contracts';
import { forbidden, notFound } from '@crewstation/kernel';
import { isCallable } from '../domain/apiOperation';
import type { ApiCatalogUseCaseDeps } from './dependencies';
import { operationToDto, proxyToDto } from './toDto';

/** 目录读侧：对所有登录用户开放（工作台内嵌 Swagger 用），带 serviceId 时要求对其项目可见。 */
export function catalogQueryUseCases({ uow, services, projects }: ApiCatalogUseCaseDeps) {
  return {
    activeProxyNameOf: async (serviceId: ServiceId): Promise<string | undefined> =>
      (await uow.read.proxies.listByService(serviceId)).find((proxy) => proxy.state === 'active')?.proxy,
    listOperations: async (actor: Actor, serviceId?: ServiceId): Promise<ApiOperationDto[]> => {
      const operations = await uow.read.operations.listActive();
      if (serviceId === undefined) return operations.map((op) => operationToDto(op));
      const resolved = await services.resolveService(serviceId);
      if (!resolved) throw notFound('服务', serviceId);
      await projects.authorize(actor, resolved.projectId, 'view');
      const granted = new Set((await uow.read.grants.listGranted(serviceId)).map((g) => g.operationId));
      return operations.map((op) => operationToDto(op, isCallable(op, granted)));
    },
    renameProxy: async (actor: Actor, id: string, name: string): Promise<ApiProxyDto> => {
      if (!actor.isAdmin) throw forbidden('只有管理员可以修改代理名称');
      const proxy = await uow.run(async (scope) => {
        const current = await scope.proxies.getById(id);
        if (!current) throw notFound('API 代理', id);
        const changed = { ...current, name };
        await scope.proxies.upsert(changed);
        return changed;
      });
      return proxyToDto(proxy, (await uow.read.operations.listByProxy(id)).filter((operation) => operation.state === 'active').length);
    },
    listProxies: async (_actor: Actor): Promise<ApiProxyDto[]> => {
      const [proxies, operations] = await Promise.all([uow.read.proxies.list(), uow.read.operations.listActive()]);
      const counts = new Map<string, number>();
      for (const op of operations) counts.set(op.proxyId, (counts.get(op.proxyId) ?? 0) + 1);
      return proxies.map((proxy) => proxyToDto(proxy, counts.get(proxy.id) ?? 0));
    },
  };
}
