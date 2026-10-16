import { z } from 'zod';
import { ResourceIdSchema, TaskIdSchema } from '../../ids';

/** Platform identities only: callers never choose native paths or PVC names. */
export const BotContextIdentitySchema = z.object({
  conversationId: ResourceIdSchema,
  epoch: z.number().int().positive(),
}).strict();
export const BotContextStorageSchema = BotContextIdentitySchema.extend({
  version: z.literal(1), ownerTaskId: TaskIdSchema,
  pvcName: z.string().regex(/^bot-[a-f0-9]{32}$/), volumeUid: z.string().min(1),
  mode: z.enum(['create', 'existing']),
}).strict();
export const BotContextLaunchSchema = BotContextIdentitySchema.extend({
  version: z.literal(1), requestId: z.uuid(),
}).strict();
export const BotMessageReceiptSchema = z.object({
  requestId: z.uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), agentId: z.string().min(1),
  state: z.enum(['dispatching', 'accepted', 'unknown', 'rejected']),
  nativeSessionId: z.string().optional(), error: z.string().optional(),
}).strict();
export type BotContextIdentity = z.infer<typeof BotContextIdentitySchema>;
export type BotContextStorage = z.infer<typeof BotContextStorageSchema>;
export type BotContextLaunch = z.infer<typeof BotContextLaunchSchema>;
export type BotMessageReceipt = z.infer<typeof BotMessageReceiptSchema>;
export const BOT_CONTEXT_MOUNT = '/var/lib/crewstation/bot-context';
export const BOT_RECEIPTS_MOUNT = '/var/lib/crewstation/bot-receipts';
export const BOT_CONTEXT_ENV = 'CS_RUNNER_BOT_CONTEXT';
export const BOT_VOLUME_DIRECTORY = 'crewstation-bot-v1';
export function botContextPaths(ownerTaskId: string, conversationId: string, epoch: number) {
  TaskIdSchema.parse(ownerTaskId); BotContextIdentitySchema.parse({ conversationId, epoch });
  const owner = `${BOT_VOLUME_DIRECTORY}/${ownerTaskId}`, conversation = `${owner}/${conversationId}`, context = `${conversation}/${epoch}`;
  return { owner, conversation, context, native: `${context}/native`, receipts: `${context}/receipts` };
}
