import type { OpenPolicy } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation } from '../../../shared/api/useApi';

type PolicyInput = { readonly operationKey: string; readonly openPolicy: OpenPolicy };
type RevokeInput = { readonly serviceId: string; readonly operationKey: string };

/** 目标随本次命令传入，切换服务不会把晚到的策略或撤销发给新对象。 */
export function useCatalogManagementActions() {
  const invalidate = [queryKeys.operations(), queryKeys.accessRequests()];
  return {
    setPolicy: useApiMutation(({ operationKey, openPolicy }: PolicyInput) => api.apiCatalog.setOpenPolicy(operationKey, { openPolicy }), { invalidate }),
    revoke: useApiMutation(({ serviceId, operationKey }: RevokeInput) => api.apiCatalog.revokeGrant(serviceId, operationKey), { invalidate }),
  };
}

export type CatalogManagementActions = ReturnType<typeof useCatalogManagementActions>;
