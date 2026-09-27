import { z } from 'zod';
import { ProjectIdSchema, ServiceIdSchema, TaskIdSchema } from '../../ids';

export const BusinessExecutionTaskQuerySchema = z.strictObject({
  projectId: ProjectIdSchema.optional(), cursor: z.string().max(1024).optional(), limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const BusinessExecutionTaskItemSchema = z.strictObject({
  id: TaskIdSchema, projectId: ProjectIdSchema, serviceId: ServiceIdSchema, callerIdentity: z.string(), protocol: z.enum(['legacy', 'v3']),
  state: z.string(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), message: z.string().optional(), labels: z.record(z.string(), z.string()),
  attention: z.enum(['failed', 'unknown', 'none']), failedSubtasks: z.number().int().nonnegative(), unknownSubtasks: z.number().int().nonnegative(),
  latestFailure: z.strictObject({ id: z.string(), name: z.string(), state: z.string(), message: z.string().optional() }).optional(),
});
export const BusinessExecutionTaskPageSchema = z.strictObject({ items: z.array(BusinessExecutionTaskItemSchema), next: z.string().optional() });
export interface BusinessExecutionTaskQuery { projectId?: string; cursor?: string; limit?: number }
export type BusinessExecutionTaskItem = z.infer<typeof BusinessExecutionTaskItemSchema>;
export type BusinessExecutionTaskPage = z.infer<typeof BusinessExecutionTaskPageSchema>;
