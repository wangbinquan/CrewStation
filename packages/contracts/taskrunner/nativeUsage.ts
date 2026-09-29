import { z } from 'zod';
import { ExecutionObservationIdentitySchema, ExecutionObservationUsageSchema } from '../api/observability/executionObservations';

const key = z.string().min(1).max(512);
const size = z.number().int().nonnegative().max(10000);
export const NativeUsageStepSchema = z.strictObject({
  id: key, sessionId: key, parentSessionId: key.nullable(), ancestors: z.array(key).max(64),
  occurredAt: z.iso.datetime().nullable(), usage: ExecutionObservationUsageSchema,
  actualModel: z.strictObject({ provider: z.string().min(1).max(200), model: z.string().min(1).max(300), condition: z.null() }).nullable(),
});
export const NativeUsageOrderSchema = z.strictObject({ epoch: key, sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
export type NativeUsageOrder = z.infer<typeof NativeUsageOrderSchema>;
export const NativeUsageProofSchema = z.strictObject({
  contract: z.literal('opencode-child-steps-v1'), lineageKey: key, turn: key, turnIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  state: z.enum(['pending', 'complete', 'partial', 'unsupported']), root: key.nullable(), observedAt: z.iso.datetime(),
  baseline: z.strictObject({ kind: z.enum(['fresh', 'resume']), fingerprint: key.nullable(), order: NativeUsageOrderSchema.optional() }),
  order: NativeUsageOrderSchema.optional(),
  fingerprint: key.nullable(), sessions: size, steps: size, emitted: size, baselineSteps: size,
  priorRevisionGap: z.boolean(), issues: z.array(z.string().min(1).max(120)).max(30),
}).superRefine((value, ctx) => {
  if (value.state === 'complete' && value.baseline.kind === 'resume' && (value.order || value.baseline.order) && (!value.order || !value.baseline.order || value.baseline.order.epoch !== value.order.epoch || value.baseline.order.sequence >= value.order.sequence))
    ctx.addIssue({ code: 'custom', message: '恢复采集的原生顺序必须同代次且前后递增' });
  if (value.state === 'complete' && (!value.root || !value.fingerprint || value.sessions < 1 || value.steps !== value.emitted + value.baselineSteps || value.priorRevisionGap || value.issues.length ||
    (value.baseline.kind === 'resume' && !value.baseline.fingerprint)))
    ctx.addIssue({ code: 'custom', message: '完整原生采集必须证明根、遍历与恢复基线，且没有缺口' });
});
/** Numeric history for owner reconciliation; an unvisited after is never evidence of deletion. */
export const NativeUsageBaselineSchema = z.strictObject({
  lineageKey: key, turn: key, root: key, offset: size,
  steps: z.array(z.strictObject({ before: NativeUsageStepSchema, after: NativeUsageStepSchema.nullable(), afterObserved: z.boolean() })).max(100),
});
export type NativeUsageStep = z.infer<typeof NativeUsageStepSchema>;
export type NativeUsageProof = z.infer<typeof NativeUsageProofSchema>;
export type NativeUsageBaseline = z.infer<typeof NativeUsageBaselineSchema>;

/** Platform projection of one native turn; history stays out of normal task summaries. */
export const RuntimeNativeCaptureSchema = z.strictObject({
  id: key, identity: ExecutionObservationIdentitySchema, sourceId: key, proof: NativeUsageProofSchema,
  state: z.enum(['pending', 'complete', 'partial', 'unsupported']), issues: z.array(z.string().min(1).max(120)).max(40),
  receivedSteps: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), receivedBaselineSteps: size, unresolvedBaselineSteps: size, revisedBaselineSteps: size, correctedBaselineSteps: size.optional(),
  historicalRevisionGap: z.boolean(),
});
export type RuntimeNativeCapture = z.infer<typeof RuntimeNativeCaptureSchema>;
