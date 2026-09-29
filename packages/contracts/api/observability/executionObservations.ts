import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema, SubtaskIdSchema, TaskIdSchema } from '../../ids';

const key = z.string().min(1).max(512);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const watermark = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const count = z.string().regex(/^(0|[1-9]\d{0,59})$/).nullable();
export const ExecutionObservationUsageSchema = z.strictObject({ input: count, cacheRead: count, cacheWrite: count, output: count });
export const ExecutionObservationIdentitySchema = z.strictObject({
  projectId: ProjectIdSchema, taskId: TaskIdSchema, subtaskId: SubtaskIdSchema,
  executionId: ResourceIdSchema, executionGeneration: revision,
});
const envelope = { identity: ExecutionObservationIdentitySchema, sourceId: key, recordId: key, revision, occurredAt: z.iso.datetime().nullable(), observedAt: z.iso.datetime() };
/** Reuse every usage invariant for owner-specific internal identities. */
export function executionUsageSchema<I extends z.ZodType>(identity: I) {
  return z.strictObject({
    ...envelope, identity, kind: z.literal('usage'), adapterVersion: key,
    modelRef: key.nullable(), reporting: z.enum(['delta', 'cumulative']),
    inclusion: z.enum(['self', 'includes-descendants', 'unknown']),
    coverage: z.enum(['partial', 'complete', 'unknown']),
    validity: z.enum(['valid', 'correction', 'invalid-final']),
    scope: z.strictObject({ root: key, session: key, parentSession: key.nullable(), ancestors: z.array(key).max(64),
      turn: key, turnIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), level: z.enum(['request', 'self-total', 'tree-total']) }).nullable(),
    coveredThroughTurn: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    usage: ExecutionObservationUsageSchema,
    /** CS's committed reconciliation result. Snapshot import replaces this state;
     * AW must not subtract a baseline again or replay only the newest raw sample. */
    projection: z.strictObject({
      /** Increases on committed projection changes, including late older evidence. */
      projectionRevision: revision, observedRevision: revision,
      /** Native evidence revision for model metadata, independent of numeric acceptance. */
      modelRevision: revision.optional(), contribution: ExecutionObservationUsageSchema,
      coveredThrough: z.strictObject({ input: watermark, cacheRead: watermark, cacheWrite: watermark, output: watermark }).nullable(),
      complete: z.boolean(), issues: z.array(z.enum(['unknown-inclusion', 'baseline-unknown', 'baseline-exceeds-observation', 'invalid-final', 'unexplained-decrease', 'identity-conflict', 'capture-gap'])).max(16),
    }),
    basis: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('invocation') }),
      z.strictObject({ kind: z.literal('native-session'), lineageKey: key, baseline: ExecutionObservationUsageSchema.nullable() }),
    ]),
  }).superRefine((value, ctx) => {
    if (value.inclusion === 'includes-descendants' && value.scope?.level !== 'tree-total')
      ctx.addIssue({ code: 'custom', path: ['scope'], message: '含后代汇总必须给出完整覆盖范围' });
    if (value.projection.observedRevision < value.revision)
      ctx.addIssue({ code: 'custom', path: ['projection', 'observedRevision'], message: '投影修订不能早于测量修订' });
    if (value.projection.modelRevision !== undefined && (value.modelRef === null || value.projection.modelRevision > value.projection.observedRevision))
      ctx.addIssue({ code: 'custom', path: ['projection', 'modelRevision'], message: '模型证据必须已知且不晚于已观察修订' });
    if (value.scope && value.projection.coveredThrough === null)
      ctx.addIssue({ code: 'custom', path: ['projection', 'coveredThrough'], message: '有覆盖范围的投影必须携带逐桶水位' });
    for (const bucket of ['input', 'cacheRead', 'cacheWrite', 'output'] as const) {
      const through = value.projection.coveredThrough?.[bucket];
      if (value.projection.contribution[bucket] === null && through != null)
        ctx.addIssue({ code: 'custom', path: ['projection', 'coveredThrough', bucket], message: '未知贡献不能声明已知覆盖水位' });
      if (value.projection.complete && value.projection.contribution[bucket] === null)
        ctx.addIssue({ code: 'custom', path: ['projection', 'complete'], message: '缺失桶不能标为完整' });
    }
    const scope = value.scope;
    if (!scope) return;
    const path = [...scope.ancestors, scope.session];
    if (path[0] !== scope.root || new Set(path).size !== path.length || (scope.ancestors.at(-1) ?? null) !== scope.parentSession)
      ctx.addIssue({ code: 'custom', path: ['scope', 'ancestors'], message: '祖先路径必须完整且无环' });
    if (scope.level === 'tree-total' && value.coveredThroughTurn === null)
      ctx.addIssue({ code: 'custom', path: ['coveredThroughTurn'], message: '整树汇总必须给出原生轮次水位' });
    if (value.coveredThroughTurn !== null && value.coveredThroughTurn < scope.turnIndex)
      ctx.addIssue({ code: 'custom', path: ['coveredThroughTurn'], message: '覆盖水位不能早于范围开始' });
  });
}
export const ExecutionUsageObservationSchema = executionUsageSchema(ExecutionObservationIdentitySchema);
const valuation = {
  ...envelope, kind: z.literal('valuation'), valuationId: key,
  /** usageRevision references projectionRevision, not the highest native revision. */
  valuationRevision: revision, usageRevision: revision, currency: z.literal('CNY'),
  completeness: z.enum(['partial', 'complete', 'unknown']),
};
export const ExecutionValuationObservationSchema = z.discriminatedUnion('availability', [
  z.strictObject({ ...valuation, availability: z.literal('priced'), priceVersionRef: key,
    amountDecimal: z.string().regex(/^(0|[1-9]\d{0,71})(\.\d{1,12})?$/) }),
  z.strictObject({ ...valuation, availability: z.enum(['unpriced', 'not-authorized', 'pending']),
    priceVersionRef: z.null(), amountDecimal: z.null() }),
]);
export const ExecutionObservationSchema = z.union([ExecutionUsageObservationSchema, ExecutionValuationObservationSchema]);
export const ExecutionCostVisibilitySchema = z.enum(['hidden', 'project-members-and-services']);
export const SetExecutionCostVisibilitySchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  requestKey: z.string().min(8).max(128), visibility: ExecutionCostVisibilitySchema,
});
export const ExecutionCostVisibilityDtoSchema = z.strictObject({
  projectId: ProjectIdSchema, revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  visibility: ExecutionCostVisibilitySchema, updatedAt: z.iso.datetime().nullable(),
});
const limit = z.coerce.number<number | string>().int().min(1).max(500).default(200);
export const ExecutionObservationQuerySchema = z.union([
  z.strictObject({ after: key.optional(), limit }),
  z.strictObject({ snapshot: z.literal('true'), snapshotId: key.optional(), cursor: key.optional(), limit })
    .refine((value) => (value.snapshotId === undefined) === (value.cursor === undefined), '快照续页必须同时指定 snapshotId 和 cursor'),
]);
const page = {
  schemaVersion: z.literal(1), capability: z.literal('executionObservationsV1'),
  projectId: ProjectIdSchema, taskId: TaskIdSchema,
  items: z.array(ExecutionObservationSchema).max(500), nextCursor: key.nullable(),
  persistedThrough: key, firstAvailableCursor: key, asOf: z.iso.datetime(),
  visibilityRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), costVisibility: ExecutionCostVisibilitySchema,
  gaps: z.array(z.strictObject({ after: key.nullable(), through: key, reason: z.enum(['expired', 'source-reset', 'capture-incomplete']) })).max(100),
};
export const ExecutionObservationPageSchema = z.discriminatedUnion('mode', [
  z.strictObject({ ...page, mode: z.literal('incremental') }),
  z.strictObject({ ...page, mode: z.literal('snapshot'), snapshotId: key, snapshotThrough: key, expiresAt: z.iso.datetime() }),
]).superRefine((value, ctx) => {
  for (const [index, item] of value.items.entries()) {
    if (item.identity.taskId !== value.taskId || item.identity.projectId !== value.projectId)
      ctx.addIssue({ code: 'custom', path: ['items', index, 'identity'], message: '观测项与页面身份不一致' });
    if (value.costVisibility === 'hidden' && item.kind === 'valuation' && item.availability === 'priced')
      ctx.addIssue({ code: 'custom', path: ['items', index], message: '隐藏金额页面不能包含估值' });
  }
});

export type ExecutionObservationIdentity = z.infer<typeof ExecutionObservationIdentitySchema>;
export type ExecutionObservationUsage = z.infer<typeof ExecutionObservationUsageSchema>;
export type ExecutionUsageObservation = z.infer<typeof ExecutionUsageObservationSchema>;
export type ExecutionValuationObservation = z.infer<typeof ExecutionValuationObservationSchema>;
export type ExecutionObservation = z.infer<typeof ExecutionObservationSchema>;
export type ExecutionObservationQuery = z.infer<typeof ExecutionObservationQuerySchema>;
export type ExecutionObservationPage = z.infer<typeof ExecutionObservationPageSchema>;
export type ExecutionCostVisibility = z.infer<typeof ExecutionCostVisibilitySchema>;
export type ExecutionCostVisibilityDto = z.infer<typeof ExecutionCostVisibilityDtoSchema>;
export type SetExecutionCostVisibility = z.infer<typeof SetExecutionCostVisibilitySchema>;
