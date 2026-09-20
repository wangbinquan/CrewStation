import { ServicePlanDtoSchema, ServicePlanInputSchema, TaskProfileDtoSchema, TaskProfileInputSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import type { ResourceCatalogEntry, ResourceCatalogInput, ResourceCatalogKind } from './resourceCatalogDraft';
import { sameResourceCatalogEntry } from './resourceCatalogDraft';

export function resourceCatalogAccess(kind: ResourceCatalogKind, readError: string, writeError: string) {
  const schema = kind === 'service' ? ServicePlanDtoSchema : TaskProfileDtoSchema;
  return {
    key: kind === 'service' ? queryKeys.servicePlans() : queryKeys.taskProfiles(),
    read: async (): Promise<{ items: ResourceCatalogEntry[] }> => {
      const result = kind === 'service' ? await api.catalog.listServicePlans() : await api.catalog.listTaskProfiles();
      const parsed = schema.array().safeParse(result.items);
      if (!parsed.success || new Set(parsed.data.map((entry) => entry.id)).size !== parsed.data.length) throw new Error(readError);
      return { items: parsed.data };
    },
    write: async (input: ResourceCatalogInput): Promise<ResourceCatalogEntry> => {
      const { id, ...body } = input;
      const result = kind === 'service'
        ? await (id ? api.catalog.updateServicePlan(id, ServicePlanInputSchema.parse(body)) : api.catalog.createServicePlan(ServicePlanInputSchema.parse(body)))
        : await (id ? api.catalog.updateTaskProfile(id, TaskProfileInputSchema.parse(body)) : api.catalog.createTaskProfile(TaskProfileInputSchema.parse(body)));
      const parsed = schema.safeParse(result);
      if (!parsed.success || !sameResourceCatalogEntry(parsed.data, input)) throw new Error(writeError);
      return parsed.data;
    },
  };
}
