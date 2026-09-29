import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { RuntimeNativeCaptureSchema } from '../../taskrunner/nativeUsage';
import { ExecutionObservationIdentitySchema, ExecutionValuationObservationSchema, executionUsageSchema } from './executionObservations';

/** Internal ownership only. taskId is the actual parent workspace, never a fabricated business task. */
export const DevelopmentUsageIdentitySchema = ExecutionObservationIdentitySchema.omit({ subtaskId: true }).extend({
  sourceKind: z.enum(['development-agent', 'development-cli']), agentId: ResourceIdSchema,
});
/** The unchanged business branch preserves existing meter keys and accepted price receipts. */
export const UsageExecutionIdentitySchema = z.union([ExecutionObservationIdentitySchema, DevelopmentUsageIdentitySchema]);
export const UsageRecordSchema = executionUsageSchema(UsageExecutionIdentitySchema);
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
