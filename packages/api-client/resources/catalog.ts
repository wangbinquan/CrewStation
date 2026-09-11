import type { ServicePlanDto, TaskProfileDto } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import type { ServicePlanInput, TaskProfileInput } from '../requestInputs';

/** 套餐目录：读对所有用户开放，写只有管理员。 */
export interface CatalogResource {
  /** GET /v1/catalog/service-plans */
  listServicePlans(): Promise<ItemsPage<ServicePlanDto>>;
  /** PUT /v1/catalog/service-plans（按 name 新增或覆盖） */
  upsertServicePlan(input: ServicePlanInput): Promise<ServicePlanDto>;
  /** GET /v1/catalog/task-profiles */
  listTaskProfiles(): Promise<ItemsPage<TaskProfileDto>>;
  /** PUT /v1/catalog/task-profiles（按 name 新增或覆盖） */
  upsertTaskProfile(input: TaskProfileInput): Promise<TaskProfileDto>;
}

export function catalogResource(transport: Transport): CatalogResource {
  return {
    listServicePlans: () => transport.request<ItemsPage<ServicePlanDto>>('GET', '/v1/catalog/service-plans'),
    upsertServicePlan: (input) => transport.request<ServicePlanDto>('PUT', '/v1/catalog/service-plans', { body: input }),
    listTaskProfiles: () => transport.request<ItemsPage<TaskProfileDto>>('GET', '/v1/catalog/task-profiles'),
    upsertTaskProfile: (input) => transport.request<TaskProfileDto>('PUT', '/v1/catalog/task-profiles', { body: input }),
  };
}
