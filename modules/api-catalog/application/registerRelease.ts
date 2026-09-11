import type { DomainPayload, ServiceId } from '@crewstation/contracts';
import { conflict, notFound, validation } from '@crewstation/kernel';
import { reconcileOperations } from '../domain/apiOperation';
import type { ApiProxy } from '../domain/apiProxy';
import { operationsFromOpenApi } from '../domain/openApiOperations';
import type { RepositoryScope } from '../ports/unitOfWork';
import type { ApiCatalogUseCaseDeps } from './dependencies';

type ReleaseRegistered = DomainPayload<'release.registered'>;

/**
 * 消费 release.registered：接入容器按 `spec.proxy` 登记，数字人的 `apis.exposes` 以服务 slug 为 proxy 名登记，
 * 去掉 exposes 的数字人其代理标记 removed。幂等，事件重放安全；事件缺 OpenAPI 文档时抛错而不是清空目录。
 */
export function registerReleaseUseCase({ uow, services, clock }: ApiCatalogUseCaseDeps) {
  return async (event: ReleaseRegistered): Promise<void> => {
    const { manifest } = event;
    const now = clock.now();
    if (manifest.kind === 'EventProducer') {
      // EventProducer 不暴露 API，但它的项目是从最小示例模板初始化的，首个发布会按模板的
      // apis.exposes 登记过一个代理条目。这里直接 return 会把那条留在目录里永远 active。
      await uow.run((scope) => removeProxiesOf(scope, event.serviceId, undefined, now));
      return;
    }
    if (manifest.kind === 'APIProxy') {
      const document = requireDocument(event);
      await uow.run((scope) => register(scope, {
        proxy: manifest.spec.proxy, projectId: event.projectId, serviceId: event.serviceId, kind: 'APIProxy',
        upstreamConnection: manifest.spec.upstream.connection, document, state: 'active', updatedAt: now,
      }));
      return;
    }
    if (!manifest.spec.apis.exposes) {
      await uow.run((scope) => removeProxiesOf(scope, event.serviceId, undefined, now));
      return;
    }
    const resolved = await services.resolveService(event.serviceId);
    if (!resolved) throw notFound('服务', event.serviceId);
    const document = requireDocument(event);
    await uow.run((scope) => register(scope, {
      proxy: resolved.slug, projectId: event.projectId, serviceId: event.serviceId, kind: 'DigitalWorker', document, state: 'active', updatedAt: now,
    }));
  };
}

function requireDocument(event: ReleaseRegistered): unknown {
  if (event.openapiDocument === undefined) throw validation(`发布 ${event.releaseId} 声明了对外 API，但事件未携带 OpenAPI 文档`);
  return event.openapiDocument;
}

/** 同名代理只能属于一个服务；同一服务改名后旧代理标记 removed。 */
async function register(scope: RepositoryScope, proxy: ApiProxy): Promise<void> {
  const existing = await scope.proxies.getByName(proxy.proxy);
  if (existing && existing.serviceId !== proxy.serviceId) {
    throw conflict(`代理名 ${proxy.proxy} 已被服务 ${existing.serviceId} 使用`, { proxy: proxy.proxy });
  }
  const discovered = operationsFromOpenApi(proxy.document);
  const current = await scope.operations.listByProxy(proxy.proxy);
  await scope.proxies.upsert(proxy);
  await scope.operations.upsertMany(reconcileOperations(current, discovered, proxy.proxy, proxy.updatedAt));
  await removeProxiesOf(scope, proxy.serviceId, proxy.proxy, proxy.updatedAt);
}

async function removeProxiesOf(scope: RepositoryScope, serviceId: ServiceId, except: string | undefined, now: Date): Promise<void> {
  for (const proxy of await scope.proxies.listByService(serviceId)) {
    if (proxy.proxy === except || proxy.state === 'removed') continue;
    await scope.proxies.upsert({ ...proxy, state: 'removed', updatedAt: now });
    await scope.operations.upsertMany(reconcileOperations(await scope.operations.listByProxy(proxy.proxy), [], proxy.proxy, now));
  }
}
