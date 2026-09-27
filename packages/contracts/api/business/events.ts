import { z } from 'zod';
import { SubtaskIdSchema, TaskIdSchema } from '../../ids';
import { BusinessDigestSchema, BusinessGenerationSchema, BusinessProcessStateSchema, BusinessSubtaskStateV3Schema, BusinessTaskStateV3Schema } from './executionValues';

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
export const BusinessUsageSchema = z.strictObject({
  measurementId: z.string().min(1).max(256), scope: z.string().min(1).max(256), mode: z.enum(['cumulative', 'delta']),
  inputTokens: count, outputTokens: count, cacheReadTokens: count, cacheWriteTokens: count, complete: z.boolean(),
});
export const BusinessResultSchema = z.strictObject({
  exitCode: z.number().int().nullable(), reason: z.string().max(4096), stdout: z.string(), stderr: z.string(), truncated: z.boolean(),
  files: z.array(z.strictObject({ path: z.string(), version: BusinessDigestSchema, size: z.number().int().min(0) })),
  finalCursor: z.string().min(1),
});
const envelope = {
  taskId: TaskIdSchema, subtaskId: SubtaskIdSchema.optional(), attempt: BusinessGenerationSchema.optional(),
  cursor: z.string().min(1), occurredAt: z.iso.datetime(), sourceEventId: z.string().min(1),
};
export const BusinessEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('task-state'), data: z.strictObject({ state: BusinessTaskStateV3Schema, generation: BusinessGenerationSchema }) }),
  z.strictObject({ ...envelope, type: z.literal('execution-state'), data: z.strictObject({ state: BusinessSubtaskStateV3Schema, process: BusinessProcessStateSchema, reason: z.string().optional() }) }),
  z.strictObject({ ...envelope, type: z.literal('text'), data: z.strictObject({ text: z.string() }) }),
  z.strictObject({ ...envelope, type: z.literal('tool-start'), data: z.strictObject({ callId: z.string(), name: z.string(), input: z.unknown().optional() }) }),
  z.strictObject({ ...envelope, type: z.literal('tool-end'), data: z.strictObject({ callId: z.string(), name: z.string(), output: z.unknown().optional(), isError: z.boolean() }) }),
  z.strictObject({ ...envelope, type: z.literal('session'), data: z.strictObject({ sessionId: z.string().min(1) }) }),
  z.strictObject({ ...envelope, type: z.literal('usage'), data: BusinessUsageSchema }),
  z.strictObject({ ...envelope, type: z.literal('output'), data: z.strictObject({ stream: z.enum(['stdout', 'stderr']), text: z.string() }) }),
  z.strictObject({ ...envelope, type: z.literal('result'), data: BusinessResultSchema }),
  z.strictObject({ ...envelope, type: z.literal('gap'), data: z.strictObject({ reason: z.string(), earliestCursor: z.string(), snapshotUrl: z.string() }) }),
]);
export const BusinessEventQuerySchema = z.strictObject({ after: z.string().min(1).max(4096).optional(), limit: z.coerce.number<number | string>().int().min(1).max(1000).default(200), subtaskId: SubtaskIdSchema.optional() });
export const BusinessEventPageSchema = z.strictObject({ items: z.array(BusinessEventSchema), nextCursor: z.string().nullable(), hasMore: z.boolean() });

export type BusinessUsage = z.infer<typeof BusinessUsageSchema>;
export type BusinessResult = z.infer<typeof BusinessResultSchema>;
export type BusinessEvent = z.infer<typeof BusinessEventSchema>;
export type BusinessEventQuery = z.infer<typeof BusinessEventQuerySchema>;
export type BusinessEventPage = z.infer<typeof BusinessEventPageSchema>;

export type BusinessEventQueryInput = z.input<typeof BusinessEventQuerySchema>;
