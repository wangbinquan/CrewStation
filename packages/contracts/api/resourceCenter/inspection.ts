import { z } from 'zod';
import { ResourceActionDescriptorSchema, ResourceFieldSchema, ResourceTargetSchema, ResourceValuesSchema } from './actions';
import { ResourceCatalogPolicySchema } from './catalog';
import { ResourceQuotaMetricSchema } from './snapshot';

export const ResourceTargetDescriptionSchema = z.object({
  target: ResourceTargetSchema, name: z.string(), revision: z.string(), current: ResourceValuesSchema,
  fields: z.array(ResourceFieldSchema), impact: z.array(z.string()), owned: z.boolean(), available: z.boolean(),
  reason: z.string().optional(), explicitlyRequestable: z.boolean().optional(),
  actionLabel: z.string().optional(),
  description: z.string().optional(), facts: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  metrics: z.array(ResourceQuotaMetricSchema).optional(), source: z.enum(['automatic', 'inherited', 'granted', 'configuration']).optional(),
});
export const ResourceTargetInspectionSchema = z.object({ view: ResourceTargetDescriptionSchema, actions: z.array(ResourceActionDescriptorSchema), policy: ResourceCatalogPolicySchema.nullable(), requestable: z.boolean() });
export type ResourceTargetDescription = z.infer<typeof ResourceTargetDescriptionSchema>;
export type ResourceTargetInspection = z.infer<typeof ResourceTargetInspectionSchema>;
