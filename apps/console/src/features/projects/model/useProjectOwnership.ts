import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';

export interface ProjectOwnership {
  readonly isAdmin: boolean;
  /** 项目负责人（或平台管理员）：成员管理与切流按钮据此显示。 */
  readonly isOwner: boolean;
}

/**
 * 只用于决定是否显示写操作入口；真正的授权在服务端。
 * 因此这里判断错了也不会越权，后端返回 403 时页面照常展示原因。
 */
export function useProjectOwnership(projectId: string): ProjectOwnership {
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const isAdmin = me.data?.isAdmin === true;
  const isOwner = isAdmin || (me.data?.memberships ?? []).some((m) => m.projectId === projectId && m.role === 'owner');
  return { isAdmin, isOwner };
}
