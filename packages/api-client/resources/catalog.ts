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
  /** PUT /v1/catalog/service-plans（按 name 新增或覆盖） */
  upsertServicePlan(input: ServicePlanInput): Promise<ServicePlanDto>;
  /** GET /v1/catalog/task-profiles */
  listTaskProfiles(): Promise<ItemsPage<TaskProfileDto>>;
  /** PUT /v1/catalog/task-profiles（按 name 新增或覆盖） */
  upsertTaskProfile(input: TaskProfileInput): Promise<TaskProfileDto>;
  /** GET /v1/catalog/compute-profiles：租户投影——档位名、说明、是否仅终端、是否默认与能否选用（RFC-001、RFC-006）。管理在 computeProfiles。 */
  listComputeProfiles(projectId?: string): Promise<ItemsPage<ComputeProfileSummaryDto>>;
}

export function catalogResource(transport: Transport): CatalogResource {
  return {
    projectCreation: () => transport.request('GET', '/v1/catalog/project-creation'),
    listProjectTemplates: () => transport.request<ItemsPage<ProjectTemplateDto>>('GET', '/v1/catalog/project-templates'),
    listServicePlans: () => transport.request<ItemsPage<ServicePlanDto>>('GET', '/v1/catalog/service-plans'),
    upsertServicePlan: (input) => transport.request<ServicePlanDto>('PUT', '/v1/catalog/service-plans', { body: input }),
    listTaskProfiles: () => transport.request<ItemsPage<TaskProfileDto>>('GET', '/v1/catalog/task-profiles'),
    upsertTaskProfile: (input) => transport.request<TaskProfileDto>('PUT', '/v1/catalog/task-profiles', { body: input }),
    listComputeProfiles: (projectId) => transport.request<ItemsPage<ComputeProfileSummaryDto>>('GET', projectId ? `/v1/projects/${segment(projectId)}/compute-profiles` : '/v1/catalog/compute-profiles'),
  };
}
