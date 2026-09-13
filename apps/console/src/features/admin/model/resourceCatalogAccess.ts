import { ServicePlanDtoSchema, TaskProfileDtoSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import type { ResourceCatalogEntry, ResourceCatalogKind } from './resourceCatalogDraft';
import { sameResourceCatalogEntry } from './resourceCatalogDraft';

export function resourceCatalogAccess(kind: ResourceCatalogKind, readError: string, writeError: string) {
  const schema = kind === 'service' ? ServicePlanDtoSchema : TaskProfileDtoSchema;
  return {
    key: kind === 'service' ? queryKeys.servicePlans() : queryKeys.taskProfiles(),
    read: async (): Promise<{ items: ResourceCatalogEntry[] }> => {
      const result = kind === 'service' ? await api.catalog.listServicePlans() : await api.catalog.listTaskProfiles();
      const parsed = schema.array().safeParse(result.items);
      if (!parsed.success || new Set(parsed.data.map((entry) => entry.name)).size !== parsed.data.length) throw new Error(readError);
      return { items: parsed.data };
    },
    write: async (input: ResourceCatalogEntry): Promise<ResourceCatalogEntry> => {
      const result = kind === 'service' ? await api.catalog.upsertServicePlan(ServicePlanDtoSchema.parse(input)) : await api.catalog.upsertTaskProfile(TaskProfileDtoSchema.parse(input));
      const parsed = schema.safeParse(result);
      if (!parsed.success || !sameResourceCatalogEntry(parsed.data, input)) throw new Error(writeError);
      return parsed.data;
    },
  };
}
