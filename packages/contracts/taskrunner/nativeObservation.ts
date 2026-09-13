import { z } from 'zod';

const id = z.string().min(1).max(96);
const base = { eventId: id, sessionId: id, at: z.iso.datetime() };
/** 插件在 CLI 内即裁去正文；接收端再次校验，不接受任意原始事件。 */
export const OpencodeActivityInputSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('session'), parentId: id.nullable() }).strict(),
  z.object({ ...base, type: z.literal('prompt'), messageId: id }).strict(),
  z.object({ ...base, type: z.literal('status'), status: z.enum(['idle', 'busy', 'retry']) }).strict(),
  z.object({ ...base, type: z.literal('assistant'), messageId: id, parentId: id, createdAt: z.number().finite(), completed: z.boolean(), finish: z.string().max(64).optional(), error: z.string().max(128).optional() }).strict(),
  z.object({ ...base, type: z.literal('request'), requestId: id, requestKind: z.enum(['question', 'permission']), messageId: id.optional() }).strict(),
  z.object({ ...base, type: z.literal('resolved'), requestId: id, resolution: z.enum(['answered', 'rejected']) }).strict(),
]);
export type OpencodeActivityInput = z.infer<typeof OpencodeActivityInputSchema>;

export const NativeObservationEnvelopeSchema = z.object({
  protocol: z.literal(1), sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  event: z.union([OpencodeActivityInputSchema, z.object({ type: z.literal('ready') }).strict(), z.object({ type: z.literal('heartbeat') }).strict(), z.object({ type: z.literal('gap') }).strict()]),
}).strict();
