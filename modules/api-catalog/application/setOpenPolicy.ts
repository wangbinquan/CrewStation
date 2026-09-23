import type { Actor, ApiOperationDto, OpenPolicy } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { forbidden, notFound } from '@crewstation/kernel';
import type { ApiCatalogUseCaseDeps } from './dependencies';
import { operationToDto } from './toDto';

/**
 * 管理员标注开放策略（R31）；默认开放的操作进入放行表的 defaultOpen，对所有已发布服务生效。
 * 生效靠网关重算放行表，所以同一事务里发出变更事件；此前不发，要等某次无关的重算才生效（2026-09-23 RFC-021 实机撞见）。
 */
export function setOpenPolicyUseCase({ uow, clock }: ApiCatalogUseCaseDeps) {
  return async (actor: Actor, operationId: string, policy: OpenPolicy): Promise<ApiOperationDto> => {
    if (!actor.isAdmin) throw forbidden('只有管理员可以设置开放策略');
    const now = clock.now();
    return uow.run(async (scope) => {
      const operation = await scope.operations.getById(operationId);
      if (!operation || operation.state !== 'active') throw notFound('操作', operationId);
      const next = { ...operation, openPolicy: policy, updatedAt: now };
      await scope.operations.update(next);
      await scope.events.publish(DomainTopic.openPolicyChanged, { occurredAt: now.toISOString(), operationId, openPolicy: policy });
      return operationToDto(next);
    });
  };
}
