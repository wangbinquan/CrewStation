import { segment } from '../requestUrl';
import type { ProjectCreationCatalog, ComputeProfileSummaryDto, ProjectTemplateDto, ServicePlanDto, TaskProfileDto } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import type { ServicePlanInput, TaskProfileInput } from '../requestInputs';

/** 套餐与算力档位目录：读对所有用户开放，写只有管理员。 */
export interface CatalogResource {
  /** 管理员：当前控制面可用于创建项目的真实模板。 */
  projectCreation(): Promise<ProjectCreationCatalog>;
  listProjectTemplates(): Promise<ItemsPage<ProjectTemplateDto>>;
  /** GET /v1/catalog/service-plans */
  listServicePlans(): Promise<ItemsPage<ServicePlanDto>>;
  /** POST 创建新资源；名称不会覆盖已有套餐。 */
  createServicePlan(input: ServicePlanInput & { id?: string }): Promise<ServicePlanDto>;
  /** GET /v1/catalog/task-profiles */
  listTaskProfiles(): Promise<ItemsPage<TaskProfileDto>>;
  /** POST 创建新任务规格。 */
  createTaskProfile(input: TaskProfileInput & { id?: string }): Promise<TaskProfileDto>;
  updateServicePlan(id: string, input: ServicePlanInput): Promise<ServicePlanDto>;
  updateTaskProfile(id: string, input: TaskProfileInput): Promise<TaskProfileDto>;
  /** GET /v1/catalog/compute-profiles：租户投影——档位名、说明、是否仅终端、是否默认与能否选用（RFC-001、RFC-006）。管理在 computeProfiles。 */
  listComputeProfiles(projectId?: string): Promise<ItemsPage<ComputeProfileSummaryDto>>;
}

export function catalogResource(transport: Transport): CatalogResource {
  return {
    projectCreation: () => transport.request('GET', '/v1/catalog/project-creation'),
    listProjectTemplates: () => transport.request<ItemsPage<ProjectTemplateDto>>('GET', '/v1/catalog/project-templates'),
    listServicePlans: () => transport.request<ItemsPage<ServicePlanDto>>('GET', '/v1/catalog/service-plans'),
    createServicePlan: (input) => transport.request<ServicePlanDto>('POST', '/v1/catalog/service-plans', { body: input }),
    listTaskProfiles: () => transport.request<ItemsPage<TaskProfileDto>>('GET', '/v1/catalog/task-profiles'),
    createTaskProfile: (input) => transport.request<TaskProfileDto>('POST', '/v1/catalog/task-profiles', { body: input }),
    updateServicePlan: (id, input) => transport.request('PUT', `/v1/catalog/service-plans/${segment(id)}`, { body: input }),
    updateTaskProfile: (id, input) => transport.request('PUT', `/v1/catalog/task-profiles/${segment(id)}`, { body: input }),
    listComputeProfiles: (projectId) => transport.request<ItemsPage<ComputeProfileSummaryDto>>('GET', projectId ? `/v1/projects/${segment(projectId)}/compute-profiles` : '/v1/catalog/compute-profiles'),
  };
}
