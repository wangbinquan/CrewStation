import type { GrantedOperations } from '../api/moduleApi';
import type { ApiCatalogUseCaseDeps } from './dependencies';

/** 放行表输入：已授权键只保留目录中仍活动的（被移除的操作其 Grant 保留但不下发）；未知调用方得到空授权但仍看到默认开放。 */
export function grantedOperationsUseCase({ uow, services }: ApiCatalogUseCaseDeps) {
  return async (callerIdentity: string): Promise<GrantedOperations> => {
    const operations = await uow.read.operations.listActive();
    const defaultOpen = operations.filter((op) => op.openPolicy === 'default').map((op) => op.key);
    const caller = await services.resolveServiceIdentity(callerIdentity);
    if (!caller) return { operations: [], defaultOpen };
    const active = new Set(operations.map((op) => op.key));
    const granted = (await uow.read.grants.listGranted(caller.serviceId)).map((g) => g.operationKey).filter((key) => active.has(key));
    return { operations: granted, defaultOpen };
  };
}
