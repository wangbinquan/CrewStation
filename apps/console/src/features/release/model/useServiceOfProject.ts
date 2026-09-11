import type { ProjectDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import type { ApiClientError } from '../../../shared/api/useApi';

export interface ServiceOfProject {
  readonly project: ProjectDto | undefined;
  /** 开通完成前为空：没有服务就没有分支、槽与 Release 可谈。 */
  readonly serviceId: string | undefined;
  readonly isPending: boolean;
  readonly error: ApiClientError | null;
}

/** 发布页的路由参数是 projectId，而发布相关的接口都挂在 serviceId 上。 */
export function useServiceOfProject(projectId: string): ServiceOfProject {
  const project = useApiQuery(queryKeys.project(projectId), () => api.projects.get(projectId));
  return { project: project.data, serviceId: project.data?.serviceId, isPending: project.isPending, error: project.error };
}
