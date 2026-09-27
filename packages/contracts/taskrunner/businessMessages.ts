import { z } from 'zod';
import { ResourceIdSchema } from '../ids';

export const BusinessMessageReceiptSchema = z.object({
  executionId: ResourceIdSchema, attempt: z.number().int().positive(), messageId: ResourceIdSchema,
  incarnation: z.uuid(), payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(['sending', 'delivered', 'failed', 'unknown']), errorCode: z.string().optional(),
}).strict();
export type RunnerBusinessMessageReceipt = z.infer<typeof BusinessMessageReceiptSchema>;
export const BusinessMessageCommands = [
  z.object({ id: z.string().min(1), type: z.literal('sendBusinessMessage'), executionId: ResourceIdSchema, attempt: z.number().int().positive(),
    messageId: ResourceIdSchema, incarnation: z.uuid(), payloadDigest: z.string().regex(/^[a-f0-9]{64}$/), digestNonce: z.string().regex(/^[a-f0-9]{64}$/), content: z.string().min(1).max(1024 * 1024) }).strict(),
  z.object({ id: z.string().min(1), type: z.literal('getBusinessMessage'), executionId: ResourceIdSchema, messageId: ResourceIdSchema }).strict(),
] as const;
export function businessMessageDigestInput(content: string, nonce: string): string { return JSON.stringify({ nonce, content }); }
