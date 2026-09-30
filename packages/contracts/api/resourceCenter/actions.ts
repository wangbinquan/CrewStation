import { z } from 'zod';

export const ResourceTypeSchema = z.enum(['service-plan', 'task-profile', 'compute-profile', 'runtime-image', 'object-plan', 'api-operation', 'execution-quota', 'namespace-quota', 'object-space', 'gateway-limit', 'production-data']);
export const ResourceChangeActionSchema = z.enum(['grant', 'revoke', 'set-quota', 'set-default', 'production-access']);
export const ResourceTargetSchema = z.object({ resourceType: ResourceTypeSchema, resourceId: z.string().min(1).max(240), action: ResourceChangeActionSchema }).strict();
export const ResourceValuesSchema = z.record(z.string().min(1).max(80), z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()])).refine((v) => Object.keys(v).length <= 20, '最多 20 个参数');
export const ResourceFieldSchema = z.object({
  key: z.string(), label: z.string(), type: z.enum(['number', 'select', 'text', 'boolean']),
  unit: z.string().optional(), required: z.boolean(), min: z.number().optional(), max: z.number().optional(), integer: z.boolean().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
});
export const ResourceActionDescriptorSchema = z.object({
  id: z.string(), kind: z.enum(['request', 'direct', 'catalog-policy', 'configure']), label: z.string(),
  target: ResourceTargetSchema.optional(), revision: z.string().optional(), current: ResourceValuesSchema.optional(),
  fields: z.array(ResourceFieldSchema), impact: z.array(z.string()), enabled: z.boolean(), reason: z.string().optional(), route: z.string().optional(),
});
export type ResourceType = z.infer<typeof ResourceTypeSchema>;
export type ResourceChangeAction = z.infer<typeof ResourceChangeActionSchema>;
export type ResourceTarget = z.infer<typeof ResourceTargetSchema>;
export type ResourceValues = z.infer<typeof ResourceValuesSchema>;
export type ResourceField = z.infer<typeof ResourceFieldSchema>;
export type ResourceActionDescriptor = z.infer<typeof ResourceActionDescriptorSchema>;
