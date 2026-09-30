import type { Actor, ResourceTarget, ResourceValues, ServiceId } from '@crewstation/contracts';
import { DomainTopic, ResourceIdSchema } from '@crewstation/contracts';
import { conflict, forbidden, jsonHash, notFound, precondition, validation } from '@crewstation/kernel';
import { apiAllocationRevision } from '../api/allocationRevision';
import { grantOperation, revokeGrant } from '../domain/apiGrant';
import type { ApiCatalogUseCaseDeps } from './dependencies';

export function apiResourceAllocationUseCases(deps: ApiCatalogUseCaseDeps) {
  return {
    applyResourceChange: async (actor: Actor, serviceId: ServiceId, input: { operationId: string; target: ResourceTarget; expectedRevision: string; values: ResourceValues }) => {
      if (!await deps.projects.isAdmin(actor.userId)) throw forbidden('接口授权仅平台管理员可调整');
      const service = await deps.services.resolveService(serviceId); if (!service) throw notFound('服务');
      await deps.projects.authorize(actor, service.projectId, 'view'); ResourceIdSchema.parse(input.operationId);
      if (input.target.resourceType !== 'api-operation' || !['grant', 'revoke'].includes(input.target.action) || Object.keys(input.values).length) throw validation('接口分配参数不适用');
      const hash = jsonHash({ serviceId, input });
      return deps.uow.run(async (scope) => {
        await scope.allocations.lock(serviceId);
        const old = await scope.allocations.get(serviceId, input.operationId);
        if (old) { if (old.hash !== hash) throw conflict('同一资源操作不能改变内容'); return { revision: old.revision, effect: old.effect, applied: old.applied }; }
        const op = await scope.operations.getById(input.target.resourceId); if (!op || op.state !== 'active') throw notFound('活动接口操作');
        const grant = await scope.grants.get(serviceId, op.id), owned = op.openPolicy === 'default' || grant?.state === 'granted';
        if (apiAllocationRevision(op, owned) !== input.expectedRevision) throw conflict('接口目录或项目授权已变化');
        if (op.openPolicy === 'default') throw precondition('默认开放接口无需项目授权；目录政策请在平台接口目录管理');
        const next = input.target.action === 'grant' ? grantOperation(serviceId, op.id, actor.userId, deps.clock.now()) : grant ? revokeGrant(grant, deps.clock.now()) : undefined;
        if (!next) throw notFound('接口授权');
        await scope.grants.upsert(next);
        await scope.events.publish(DomainTopic.grantChanged, { occurredAt: deps.clock.now().toISOString(), serviceId, operationId: op.id, state: next.state });
        const receipt = { revision: apiAllocationRevision(op, next.state === 'granted'), effect: '接口授权已保存；网关放行表同步后可调用', applied: false };
        await scope.allocations.save(serviceId, input.operationId, { hash, ...receipt });
        return receipt;
      });
    },
    resourceChangeReceipt: async (serviceId: ServiceId, operationId: string) => { const r = await deps.uow.read.allocations.get(serviceId, operationId); return r ? { revision: r.revision, effect: r.effect, applied: r.applied } : undefined; },
  };
}
