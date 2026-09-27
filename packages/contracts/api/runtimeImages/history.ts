import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { RuntimeImagePageQuerySchema } from './requests';

export const RuntimeImageHistoryQuerySchema = RuntimeImagePageQuerySchema.extend({ versionId: ResourceIdSchema.optional() });
export const RuntimeImageHistoryItemSchema = z.object({
  id: ResourceIdSchema, projectId: ResourceIdSchema, serviceId: ResourceIdSchema, versionId: ResourceIdSchema,
  kind: z.enum(['task', 'development', 'agent', 'cli', 'service']), state: z.string(),
  name: z.string().optional(), message: z.string().optional(), traceId: z.string().optional(), parentTaskId: ResourceIdSchema.optional(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
export type RuntimeImageHistoryItem = z.infer<typeof RuntimeImageHistoryItemSchema>;
export type RuntimeImageHistoryQuery = z.infer<typeof RuntimeImageHistoryQuerySchema>;
/** Internal read port. Omitted project scope is reserved for the authenticated platform catalog. */
export interface RuntimeImageHistoryRead { projectId?: string; versionIds: string[]; before?: string; limit: number }
export interface RuntimeImageHistoryPage { items: RuntimeImageHistoryItem[]; next?: string }
