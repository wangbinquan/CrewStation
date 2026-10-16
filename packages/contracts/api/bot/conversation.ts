import { z } from 'zod';
import { ResourceIdSchema, TaskIdSchema } from '../../ids';
import { ComputeProfileSelectorSchema } from '../compute/computeProfile';

const mutation = { requestId: z.uuid(), expectedRevision: z.number().int().nonnegative() };
export const SendBotMessageRequestSchema = z.object({ ...mutation, content: z.string().trim().min(1).max(200_000), compute: ComputeProfileSelectorSchema.optional(), runtimeImageVersionId: ResourceIdSchema.optional() }).strict();
export const InterruptBotRequestSchema = z.object({ ...mutation, expectedExecutionId: TaskIdSchema }).strict();
export const FreshBotContextRequestSchema = z.object({ ...mutation, fresh: z.literal(true) }).strict();
export const BotHistoryQuerySchema = z.object({ after: ResourceIdSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });
export const BotStateSchema = z.enum(['empty', 'preparing', 'running', 'awaiting-input', 'stopping', 'paused', 'unknown', 'unavailable']);
export const BotExecutionDtoSchema = z.object({
  agentId: ResourceIdSchema, executionTaskId: TaskIdSchema, epoch: z.number().int().positive(),
  initialPrompt: z.string().optional(), state: BotStateSchema, nativeSessionId: z.string().optional(), createdAt: z.iso.datetime(),
});
export const BotConversationDtoSchema = z.object({
  conversationId: ResourceIdSchema, taskId: TaskIdSchema, revision: z.number().int().positive(), epoch: z.number().int().positive(),
  state: BotStateSchema, continuity: z.enum(['available', 'unknown', 'unavailable']),
  nativeSessionId: z.string().optional(), volumeUid: z.string().optional(),
  computeName: z.string(), profileRevision: z.number().int().positive(), protocol: z.string(),
  pendingMessage: z.object({ id: z.uuid(), content: z.string(), createdAt: z.iso.datetime() }).optional(), execution: BotExecutionDtoSchema.optional(), reason: z.string().optional(),
});
export const BotReadDtoSchema = z.object({ conversation: BotConversationDtoSchema.nullable() });
export const BotReceiptDtoSchema = z.object({ requestId: z.uuid(), conversationId: ResourceIdSchema, revision: z.number().int().positive(), epoch: z.number().int().positive(), state: z.enum(['accepted', 'dispatched', 'unknown', 'rejected']), reason: z.string().optional() });
export const BotHistoryDtoSchema = z.object({ items: z.array(BotExecutionDtoSchema), next: ResourceIdSchema.optional() });
export type SendBotMessageRequest = z.infer<typeof SendBotMessageRequestSchema>;
export type InterruptBotRequest = z.infer<typeof InterruptBotRequestSchema>;
export type FreshBotContextRequest = z.infer<typeof FreshBotContextRequestSchema>;
export type BotHistoryQuery = z.infer<typeof BotHistoryQuerySchema>;
export type BotExecutionDto = z.infer<typeof BotExecutionDtoSchema>;
export type BotConversationDto = z.infer<typeof BotConversationDtoSchema>;
export type BotReadDto = z.infer<typeof BotReadDtoSchema>;
export type BotReceiptDto = z.infer<typeof BotReceiptDtoSchema>;
export type BotHistoryDto = z.infer<typeof BotHistoryDtoSchema>;
