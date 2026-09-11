import type { ProjectDto, ServiceDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import type { ApiClientError } from '../../../shared/api/useApi';

export interface ProjectService {
  readonly project: ProjectDto | undefined;
  readonly service: ServiceDto | undefined;
  /** 开通完成前 serviceId 为空：部署槽、仓库与发布入口都要等它。 */
  readonly serviceId: string | undefined;
  readonly isPending: boolean;
  readonly error: ApiClientError | null;
}

/** 项目 → 服务的两跳解析：先拿项目拿到 serviceId，再取服务。 */
export function useProjectService(projectId: string): ProjectService {
  const project = useApiQuery(queryKeys.project(projectId), () => api.projects.get(projectId));
  const serviceId = project.data?.serviceId;
  const service = useApiQuery(
    queryKeys.service(serviceId ?? 'pending'),
    () => api.services.get(serviceId ?? ''),
    { enabled: serviceId !== undefined },
  );
  return {
    project: project.data,
    service: service.data,
    serviceId,
    isPending: project.isPending || (serviceId !== undefined && service.isPending),
    error: project.error ?? service.error,
  };
}
