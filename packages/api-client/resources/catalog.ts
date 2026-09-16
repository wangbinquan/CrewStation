import type { ComputeProfileAdminDto, ComputeProfileDto, ComputeProfileSummaryDto, ProjectTemplateDto, ServicePlanDto, TaskProfileDto } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import type { ComputeProfileInput, ServicePlanInput, TaskProfileInput } from '../requestInputs';

/** 套餐与算力档位目录：读对所有用户开放，写只有管理员。 */
export interface CatalogResource {
  /** 管理员：当前控制面可用于创建项目的真实模板。 */
  listProjectTemplates(): Promise<ItemsPage<ProjectTemplateDto>>;
  /** GET /v1/catalog/service-plans */
  listServicePlans(): Promise<ItemsPage<ServicePlanDto>>;
  /** PUT /v1/catalog/service-plans（按 name 新增或覆盖） */
  upsertServicePlan(input: ServicePlanInput): Promise<ServicePlanDto>;
  /** GET /v1/catalog/task-profiles */
  listTaskProfiles(): Promise<ItemsPage<TaskProfileDto>>;
  /** PUT /v1/catalog/task-profiles（按 name 新增或覆盖） */
  upsertTaskProfile(input: TaskProfileInput): Promise<TaskProfileDto>;
  /** GET /v1/catalog/compute-profiles：租户投影，只有档位名与说明（RFC-001）。 */
  listComputeProfiles(): Promise<ItemsPage<ComputeProfileSummaryDto>>;
  /** GET /v1/catalog/compute-profiles?full=true：含驱动、模型与运行环境就绪信息，仅管理员；非管理员拿到的仍是租户投影。 */
  listComputeProfilesFull(): Promise<ItemsPage<ComputeProfileAdminDto>>;
  /** PUT /v1/catalog/compute-profiles（按 name 新增或覆盖；已托管档位必须带 expectedRevision） */
  upsertComputeProfile(input: ComputeProfileInput): Promise<ComputeProfileDto>;
  /** DELETE /v1/catalog/compute-profiles/:name */
  deleteComputeProfile(name: string): Promise<void>;
}

export function catalogResource(transport: Transport): CatalogResource {
  return {
    listProjectTemplates: () => transport.request<ItemsPage<ProjectTemplateDto>>('GET', '/v1/catalog/project-templates'),
    listServicePlans: () => transport.request<ItemsPage<ServicePlanDto>>('GET', '/v1/catalog/service-plans'),
    upsertServicePlan: (input) => transport.request<ServicePlanDto>('PUT', '/v1/catalog/service-plans', { body: input }),
    listTaskProfiles: () => transport.request<ItemsPage<TaskProfileDto>>('GET', '/v1/catalog/task-profiles'),
    upsertTaskProfile: (input) => transport.request<TaskProfileDto>('PUT', '/v1/catalog/task-profiles', { body: input }),
    listComputeProfiles: () => transport.request<ItemsPage<ComputeProfileSummaryDto>>('GET', '/v1/catalog/compute-profiles'),
    listComputeProfilesFull: () => transport.request<ItemsPage<ComputeProfileAdminDto>>('GET', '/v1/catalog/compute-profiles', { query: { full: 'true' } }),
    upsertComputeProfile: (input) => transport.request<ComputeProfileDto>('PUT', '/v1/catalog/compute-profiles', { body: input }),
    deleteComputeProfile: (name) => transport.request<void>('DELETE', `/v1/catalog/compute-profiles/${encodeURIComponent(name)}`),
  };
}
