import { z } from 'zod';
import { ProjectIdSchema, ServiceIdSchema, TaskIdSchema } from '../../ids';
import { BusinessTaskV3DtoSchema, BusinessSubtaskV3DtoSchema } from './responses';

export const BusinessExecutionTaskQuerySchema = z.strictObject({
  state: z.enum(['failed', 'unknown', 'paused', 'running', 'closed']).optional(),
  projectId: ProjectIdSchema.optional(), cursor: z.string().max(1024).optional(), limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const BusinessExecutionTaskItemSchema = z.strictObject({
  id: TaskIdSchema, projectId: ProjectIdSchema, serviceId: ServiceIdSchema, callerIdentity: z.string(), protocol: z.enum(['legacy', 'v3']),
  state: z.string(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), message: z.string().optional(), labels: z.record(z.string(), z.string()),
  attention: z.enum(['failed', 'unknown', 'none']), failedSubtasks: z.number().int().nonnegative(), unknownSubtasks: z.number().int().nonnegative(),
  latestFailure: z.strictObject({ id: z.string(), name: z.string(), state: z.string(), message: z.string().optional() }).optional(),
});
export const BusinessExecutionTaskPageSchema = z.strictObject({ items: z.array(BusinessExecutionTaskItemSchema), next: z.string().optional() });
export interface BusinessExecutionTaskQuery { projectId?: string; state?: 'failed' | 'unknown' | 'paused' | 'running' | 'closed'; cursor?: string; limit?: number }
export type BusinessExecutionTaskItem = z.infer<typeof BusinessExecutionTaskItemSchema>;
export type BusinessExecutionTaskPage = z.infer<typeof BusinessExecutionTaskPageSchema>;
export const BusinessRecoveryTaskDetailSchema = z.strictObject({ task: BusinessTaskV3DtoSchema, subtasks: z.array(BusinessSubtaskV3DtoSchema) });
export type BusinessRecoveryTaskDetail = z.infer<typeof BusinessRecoveryTaskDetailSchema>;
