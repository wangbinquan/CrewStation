import type { Actor, ApiOperationDto, OpenPolicy } from '@crewstation/contracts';
import { forbidden, notFound } from '@crewstation/kernel';
import type { ApiCatalogUseCaseDeps } from './dependencies';
import { operationToDto } from './toDto';

/** 管理员标注开放策略（R31）；默认开放的操作进入放行表的 defaultOpen，对所有已发布服务生效。 */
export function setOpenPolicyUseCase({ uow, clock }: ApiCatalogUseCaseDeps) {
  return async (actor: Actor, operationKey: string, policy: OpenPolicy): Promise<ApiOperationDto> => {
    if (!actor.isAdmin) throw forbidden('只有管理员可以设置开放策略');
    const now = clock.now();
    return uow.run(async (scope) => {
      const operation = await scope.operations.getByKey(operationKey);
      if (!operation || operation.state !== 'active') throw notFound('操作', operationKey);
      const next = { ...operation, openPolicy: policy, updatedAt: now };
      await scope.operations.update(next);
      return operationToDto(next);
    });
  };
}
