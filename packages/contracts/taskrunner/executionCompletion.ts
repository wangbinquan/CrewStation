import { z } from 'zod';
import { TaskIdSchema } from '../ids';
import { BusinessDigestSchema, BusinessGenerationSchema } from '../api/business/executionValues';

/** Long-lived evidence, distinct from the seven-day raw event stream and from a Pod stop proof. */
export const ExecutionCompletionProofSchema = z.strictObject({
  taskId: TaskIdSchema, executionId: z.string().min(1).max(128), attempt: BusinessGenerationSchema,
  incarnation: z.uuid(), payloadDigest: BusinessDigestSchema,
  lastSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), resultDigest: BusinessDigestSchema,
  complete: z.literal(true), persistedAt: z.iso.datetime(),
});
export type ExecutionCompletionProof = z.infer<typeof ExecutionCompletionProofSchema>;
