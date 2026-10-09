import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';

export function useReleasePermissions(projectId: string) {
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const role = me.data?.memberships?.find(member => member.projectId === projectId)?.role;
  return { me, userId: me.data?.id, canPublish: !me.error && !!me.data && (me.data.isAdmin || role === 'owner' || role === 'developer'), canSwitch: !me.error && !!me.data && (me.data.isAdmin || role === 'owner') };
}
