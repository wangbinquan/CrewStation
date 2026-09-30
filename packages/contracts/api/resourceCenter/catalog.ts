import { z } from 'zod';
import { ResourceTypeSchema } from './actions';

export const ResourceCatalogPolicySchema = z.object({ resourceType: ResourceTypeSchema, resourceId: z.string().min(1).max(240), requestable: z.boolean(), revision: z.number().int().min(0), updatedAt: z.iso.datetime().nullable() });
export const SaveResourceCatalogPolicySchema = z.object({ expectedRevision: z.number().int().min(0), requestable: z.boolean() }).strict();
export type ResourceCatalogPolicy = z.infer<typeof ResourceCatalogPolicySchema>;
export type SaveResourceCatalogPolicy = z.infer<typeof SaveResourceCatalogPolicySchema>;
