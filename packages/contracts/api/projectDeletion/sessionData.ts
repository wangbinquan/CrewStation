import { z } from 'zod';
import { ResourceIdSchema, TaskIdSchema } from '../../ids';
import { DevelopmentUsageKeySchema } from '../../taskrunner/developmentUsage';
import { DevelopmentUsageDrainReasonSchema, DevelopmentUsageRegistrationSchema } from '../../taskrunner/developmentUsageStorage';
import { RunnerUsageCaptureSchema } from '../../taskrunner/usageObservation';
import { ProjectDeletionContextSchema } from './owner';

const executionId = z.string().min(1).max(200);
const through = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const measurement = { recordId: z.string().min(1).max(512), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) };
/** Only existing original copies may be read or consumed. This has no producer, registration or unavailable operation. */
export const ProjectDeletionSessionDataSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('original-transports') }),
  z.strictObject({ type: z.literal('development-lookup') }),
  z.strictObject({ type: z.literal('development-existing'), registration: DevelopmentUsageRegistrationSchema }),
  z.strictObject({ type: z.literal('development-read'), key: DevelopmentUsageKeySchema }),
  z.strictObject({ type: z.literal('development-drain'), key: DevelopmentUsageKeySchema, reason: DevelopmentUsageDrainReasonSchema }),
  z.strictObject({ type: z.literal('development-source'), key: DevelopmentUsageKeySchema }),
  z.strictObject({ type: z.literal('development-source-ack'), key: DevelopmentUsageKeySchema, through }),
  z.strictObject({ type: z.literal('development-measurement'), key: DevelopmentUsageKeySchema, ...measurement }),
  z.strictObject({ type: z.literal('business-read'), executionId }),
  z.strictObject({ type: z.literal('business-originals'), after: executionId.nullable() }),
  z.strictObject({ type: z.literal('business-events'), executionId, after: through, limit: z.number().int().min(1).max(1000) }),
  z.strictObject({ type: z.literal('business-completion'), executionId }),
  z.strictObject({ type: z.literal('business-consume'), executionId, through, stopped: z.literal(false) }),
  z.strictObject({ type: z.literal('business-source'), executionId }),
  z.strictObject({ type: z.literal('business-source-ack'), executionId, through }),
  z.strictObject({ type: z.literal('business-measurement'), executionId, ...measurement }),
]);
export type ProjectDeletionSessionData = z.infer<typeof ProjectDeletionSessionDataSchema>;
export const ProjectDeletionSessionTransportSchema = z.strictObject({ id: ResourceIdSchema, taskId: TaskIdSchema, replica: z.url() });
export type ProjectDeletionSessionTransport = z.infer<typeof ProjectDeletionSessionTransportSchema>;
export const ProjectDeletionBusinessSourceSchema = z.strictObject({
  runtimeTaskId: TaskIdSchema, executionId, attempt: z.number().int().positive(), incarnation: z.string().min(1).max(200),
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/), after: through, through,
  events: z.array(z.strictObject({ sequence: through, agentId: z.string().min(1).max(200), occurredAt: z.string().datetime({ offset: true }), capture: RunnerUsageCaptureSchema })).min(1).max(5),
}).superRefine((page, ctx) => {
  let cursor = page.after;
  for (const event of page.events) {
    if (event.sequence <= cursor || event.sequence > page.through) ctx.addIssue({ code: 'custom', message: '数字来源页的原事件边界不符' });
    cursor = event.sequence;
  }
  if (cursor !== page.through) ctx.addIssue({ code: 'custom', message: '数字来源页缺少末尾边界' });
});
export const ProjectDeletionSessionDataRequestSchema = z.strictObject({
  context: ProjectDeletionContextSchema, taskId: TaskIdSchema, operation: ProjectDeletionSessionDataSchema,
});
/** The complete original task directory is paged separately; no synthetic task is used for project reads. */
export const ProjectDeletionSessionTasksRequestSchema = z.strictObject({ context: ProjectDeletionContextSchema, after: TaskIdSchema.nullable() });
export const ProjectDeletionSessionTasksSchema = z.array(TaskIdSchema).max(200);
