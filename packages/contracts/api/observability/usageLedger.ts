import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { RuntimeNativeCaptureSchema } from '../../taskrunner/nativeUsage';
import { NativeUsagePassIdentitySchema } from '../../taskrunner/native-usage/pages';
import { ExecutionObservationIdentitySchema, ExecutionValuationObservationSchema, ExecutionObservationScopeSchema, executionUsageSchema } from './executionObservations';

/** Internal ownership only. taskId is the actual parent workspace, never a fabricated business task. */
export const DevelopmentUsageIdentitySchema = ExecutionObservationIdentitySchema.omit({ subtaskId: true }).extend({
  sourceKind: z.enum(['development-agent', 'development-cli']), agentId: ResourceIdSchema,
});
/** The unchanged business branch preserves existing meter keys and accepted price receipts. */
export const UsageExecutionIdentitySchema = z.union([ExecutionObservationIdentitySchema, DevelopmentUsageIdentitySchema]);
const nativeKey = z.string().min(1).max(512), nativeCount = z.string().regex(/^(0|[1-9]\d*)$/), nativeDigest = z.string().regex(/^[a-f0-9]{64}$/);
/** Internal development scope. The public business media keep their unchanged legacy scope. */
export const DevelopmentNativeUsageScopeSchema = z.strictObject({
  root: nativeKey, session: nativeKey, parentSession: nativeKey.nullable(), turn: nativeKey,
  turnIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), level: z.literal('request'),
  native: z.strictObject({ passKey: nativeDigest, identity: NativeUsagePassIdentitySchema, ownerReceiptId: nativeKey,
    pageOrdinal: nativeCount, cumulativeDigest: nativeDigest, sourceNamespace: nativeDigest, pathDigest: nativeDigest, depth: nativeCount }),
}).superRefine((scope, ctx) => {
  const source = scope.native.identity;
  if (source.phase !== 'final' || source.rootSessionId !== scope.root || source.turn !== scope.turn ||
      (scope.session === scope.root) !== (scope.parentSession === null) || scope.parentSession === scope.session ||
      (scope.session === scope.root) !== (scope.native.depth === '0'))
    ctx.addIssue({ code: 'custom', message: '原生数值范围必须保留原 final 身份与根/父/深度引用' });
});
export const UsageRecordSchema = executionUsageSchema(UsageExecutionIdentitySchema,
  z.union([ExecutionObservationScopeSchema, DevelopmentNativeUsageScopeSchema])).superRefine((record, ctx) => {
    if (record.scope && 'native' in record.scope && (!('sourceKind' in record.identity) || record.inclusion !== 'self'))
      ctx.addIssue({ code: 'custom', path: ['scope'], message: '原生分页范围只属于开发执行的独立原步骤' });
  });
export const UsageValuationSchema = z.discriminatedUnion('availability', [
  ExecutionValuationObservationSchema.options[0].extend({ identity: UsageExecutionIdentitySchema }),
  ExecutionValuationObservationSchema.options[1].extend({ identity: UsageExecutionIdentitySchema }),
]);
export const UsageObservationSchema = z.union([UsageRecordSchema, UsageValuationSchema]);
export const UsageNativeCaptureSchema = RuntimeNativeCaptureSchema.extend({ identity: UsageExecutionIdentitySchema });

export type DevelopmentUsageIdentity = z.infer<typeof DevelopmentUsageIdentitySchema>;
export type UsageExecutionIdentity = z.infer<typeof UsageExecutionIdentitySchema>;
export type UsageRecord = z.infer<typeof UsageRecordSchema>;
export type UsageValuation = z.infer<typeof UsageValuationSchema>;
export type UsageObservation = z.infer<typeof UsageObservationSchema>;
export type UsageNativeCapture = z.infer<typeof UsageNativeCaptureSchema>;
