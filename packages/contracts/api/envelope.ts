import { z } from 'zod';
import { OperationIdSchema } from '../ids';

export const ErrorEnvelopeSchema = z.object({
  error: z.enum(['not_found', 'conflict', 'forbidden', 'unauthenticated', 'validation', 'precondition', 'quota_exceeded', 'unavailable', 'internal']),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).default({}),
});

export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().optional() });
}

export const OperationStateSchema = z.enum(['pending', 'running', 'succeeded', 'failed']);

/** 异步操作（构建、部署、切流、供给）的统一回执；客户端轮询或订阅它。 */
export const OperationDtoSchema = z.object({
  id: OperationIdSchema,
  kind: z.string().min(1),
  state: OperationStateSchema,
  target: z.string().min(1),
  message: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const AcceptedResponseSchema = z.object({ operationId: OperationIdSchema });

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type PageQuery = z.infer<typeof PageQuerySchema>;
export type OperationDto = z.infer<typeof OperationDtoSchema>;
export type OperationState = z.infer<typeof OperationStateSchema>;
