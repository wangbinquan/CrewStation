import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useApiQuery } from '../api/useApi';

/** 只用于项目页面的可读名称；市场上下文不读取项目内部数据。 */
export function useProjectIdentity(projectId: string | undefined) {
  return useApiQuery(queryKeys.project(projectId ?? ''), () => api.projects.get(projectId!), { enabled: Boolean(projectId) });
}
