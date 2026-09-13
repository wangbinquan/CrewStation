import type { RequestTaskDataBindingInput } from '@crewstation/api-client';
import type { DecideTaskDataBinding } from '@crewstation/contracts';
import { useRef } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
export type DataBindingsHandle = ReturnType<typeof useDataBindings>;

/** 开发会话的数据访问绑定：三种模式，后两种要负责人批准。 */
export function useDataBindings(projectId: string, taskId: string, serviceId: string | undefined, permissions: { canDevelop: boolean; canManage: boolean }) {
  const key = [...queryKeys.dataBindings(projectId), taskId], lock = useRef(false);
  const query = useApiQuery(key, () => api.tasks.listTaskDataBindings(taskId), { refetchIntervalMs: 5_000 });
  const request = useApiMutation((input: RequestTaskDataBindingInput) => api.tasks.requestDataBinding(serviceId!, taskId, input), { invalidate: [key] });
  const decision = useApiMutation((input: { id: string; decision: DecideTaskDataBinding }) => api.tasks.decideDataBinding(input.id, input.decision), { invalidate: [key] });
  const revoke = useApiMutation((id: string) => api.tasks.revokeDataBinding(id), { invalidate: [key] });
  const run = async <T,>(allowed: boolean, action: () => Promise<T>): Promise<T> => {
    if (lock.current || !allowed || query.isPending || query.error) throw new Error('数据访问记录未就绪或当前操作不可用');
    lock.current = true;
    try { return await action(); } finally { lock.current = false; }
  };
  return {
    bindings: query.data?.items ?? [], checkedAt: query.dataUpdatedAt, isPending: query.isPending, refreshing: query.isFetching, loadError: query.error, refresh: query.refetch,
    canRequest: Boolean(serviceId) && permissions.canDevelop, canManage: permissions.canManage, hasService: Boolean(serviceId),
    busy: request.isPending || decision.isPending || revoke.isPending, request, decision, revoke,
    requestAccess: (input: RequestTaskDataBindingInput) => run(Boolean(serviceId) && permissions.canDevelop, () => request.mutateAsync(input)),
    decide: (id: string, input: DecideTaskDataBinding) => run(permissions.canManage, () => decision.mutateAsync({ id, decision: input })),
    revokeAccess: (id: string) => run(permissions.canManage, () => revoke.mutateAsync(id)),
  };
}
