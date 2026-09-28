import { z } from 'zod';
import { NativeUsageProofSchema, NativeUsageBaselineSchema } from './nativeUsage';
import type { TaskId } from '../ids';
import { ExecutionUsageObservationSchema } from '../api/observability/executionObservations';

const shape = ExecutionUsageObservationSchema.shape;
/** Numeric source evidence before the platform binds project/execution identity or computes a projection. */
export const RunnerUsageMeasurementSchema = z.strictObject({
  recordId: shape.recordId, revision: shape.revision, occurredAt: shape.occurredAt, observedAt: shape.observedAt,
  adapterVersion: shape.adapterVersion, reporting: shape.reporting, inclusion: shape.inclusion,
  coverage: shape.coverage, validity: shape.validity, scope: shape.scope,
  coveredThroughTurn: shape.coveredThroughTurn, usage: shape.usage, basis: shape.basis,
  actualModel: z.strictObject({ provider: z.string().min(1).max(200).nullable(), model: z.string().min(1).max(300).nullable(), condition: z.string().min(1).max(200).nullable() }).nullable(),
}).superRefine((value, ctx) => {
  const scope = value.scope;
  if (value.inclusion === 'includes-descendants' && scope?.level !== 'tree-total')
    ctx.addIssue({ code: 'custom', path: ['scope'], message: '含后代用量需要整树范围' });
  if (!scope) return;
  const path = [...scope.ancestors, scope.session];
  if (path[0] !== scope.root || new Set(path).size !== path.length || (scope.ancestors.at(-1) ?? null) !== scope.parentSession)
    ctx.addIssue({ code: 'custom', path: ['scope'], message: '原生祖先路径不完整' });
  if ((scope.level === 'tree-total' && value.coveredThroughTurn === null) || (value.coveredThroughTurn !== null && value.coveredThroughTurn < scope.turnIndex))
    ctx.addIssue({ code: 'custom', path: ['coveredThroughTurn'], message: '原生轮次覆盖水位无效' });
});
export const RunnerUsageCaptureSchema = z.strictObject({
  nativeProof: NativeUsageProofSchema.optional(), nativeBaseline: NativeUsageBaselineSchema.optional(),
  version: z.literal(1), measurements: z.array(RunnerUsageMeasurementSchema).max(100),
  diagnostics: z.array(z.string().min(1).max(120)).max(20),
});
export type RunnerUsageMeasurement = z.infer<typeof RunnerUsageMeasurementSchema>;
export type RunnerUsageCapture = z.infer<typeof RunnerUsageCaptureSchema>;

/** Session-owned numeric outbox page, separate from the short-lived raw execution journal. */
export interface RunnerUsageSourcePage {
  runtimeTaskId: TaskId; executionId: string; attempt: number; incarnation: string; payloadDigest: string;
  after: number; through: number;
  events: Array<{ sequence: number; agentId: string; occurredAt: string; capture: RunnerUsageCapture }>;
}

export type RunnerUsageSourceIdentity = Pick<RunnerUsageSourcePage, 'runtimeTaskId' | 'executionId' | 'attempt' | 'incarnation' | 'payloadDigest'>;
