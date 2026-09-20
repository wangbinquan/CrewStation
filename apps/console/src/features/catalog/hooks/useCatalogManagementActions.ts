import type { OpenPolicy } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation } from '../../../shared/api/useApi';

type PolicyInput = { readonly operationId: string; readonly openPolicy: OpenPolicy };
type RevokeInput = { readonly serviceId: string; readonly operationId: string };

/** 目标随本次命令传入，切换服务不会把晚到的策略或撤销发给新对象。 */
export function useCatalogManagementActions() {
  const invalidate = [queryKeys.operations(), queryKeys.accessRequests()];
  return {
    setPolicy: useApiMutation(({ operationId, openPolicy }: PolicyInput) => api.apiCatalog.setOpenPolicy(operationId, { openPolicy }), { invalidate }),
    revoke: useApiMutation(({ serviceId, operationId }: RevokeInput) => api.apiCatalog.revokeGrant(serviceId, operationId), { invalidate }),
  };
}

export type CatalogManagementActions = ReturnType<typeof useCatalogManagementActions>;
