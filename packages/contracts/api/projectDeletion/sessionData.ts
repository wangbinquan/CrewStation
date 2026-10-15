import { z } from 'zod';
import { ResourceIdSchema, TaskIdSchema } from '../../ids';
import { ProjectDeletionContextSchema } from './owner';

const executionId = z.string().min(1).max(200);
const through = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Only existing original copies may be read or consumed. This has no producer, registration or unavailable operation. */
export const ProjectDeletionSessionDataSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('original-transports') }),
  z.strictObject({ type: z.literal('business-read'), executionId }),
  z.strictObject({ type: z.literal('business-originals'), after: executionId.nullable() }),
  z.strictObject({ type: z.literal('business-events'), executionId, after: through, limit: z.number().int().min(1).max(1000) }),
  z.strictObject({ type: z.literal('business-completion'), executionId }),
  z.strictObject({ type: z.literal('business-consume'), executionId, through, stopped: z.literal(false) }),
]);
export type ProjectDeletionSessionData = z.infer<typeof ProjectDeletionSessionDataSchema>;
export const ProjectDeletionSessionTransportSchema = z.strictObject({ id: ResourceIdSchema, taskId: TaskIdSchema, replica: z.url() });
export type ProjectDeletionSessionTransport = z.infer<typeof ProjectDeletionSessionTransportSchema>;
export const ProjectDeletionSessionDataRequestSchema = z.strictObject({
  context: ProjectDeletionContextSchema, taskId: TaskIdSchema, operation: ProjectDeletionSessionDataSchema,
});
/** The complete original task directory is paged separately; no synthetic task is used for project reads. */
export const ProjectDeletionSessionTasksRequestSchema = z.strictObject({ context: ProjectDeletionContextSchema, after: TaskIdSchema.nullable() });
export const ProjectDeletionSessionTasksSchema = z.array(TaskIdSchema).max(200);
