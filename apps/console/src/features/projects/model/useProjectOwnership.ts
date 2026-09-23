import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import type { ApiClientError } from '../../../shared/api/useApi';

export interface ProjectOwnership {
  readonly isAdmin: boolean;
  /** 当前已确认的项目负责人或平台管理员。 */
  readonly isOwner: boolean;
  readonly unavailable: boolean;
  readonly error: ApiClientError | null;
  readonly reload: () => Promise<unknown>;
}

/** 最新身份读取失败不沿用旧身份提供保存；保留草稿由各设置编辑器负责。身份每 15 秒由守卫重读，重读期间不算「不可用」。 */
export function useProjectOwnership(projectId: string): ProjectOwnership {
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const known = !me.isPending && !me.error, isAdmin = known && me.data?.isAdmin === true;
  const isOwner = known && (isAdmin || (me.data?.memberships ?? []).some((m) => m.projectId === projectId && m.role === 'owner'));
  return { isAdmin, isOwner, unavailable: !known, error: me.error, reload: me.refetch };
}
