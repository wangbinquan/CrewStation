import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema, ServiceIdSchema, SubtaskIdSchema, TaskIdSchema, UserIdSchema } from '../../ids';
import { BusinessExecutionFenceSchema } from './control';
import { BusinessDigestSchema, BusinessGenerationSchema, BusinessRequestKeySchema } from './executionValues';

export const BusinessRecoveryActionSchema = z.enum(['resume-task', 'rebuild-workspace', 'retry-subtask', 'resume-subtask', 'restart-task']);
export const BusinessRecoveryCapabilitySchema = z.strictObject({
  actions: z.array(BusinessRecoveryActionSchema).min(1).max(5).refine((items) => new Set(items).size === items.length, '恢复动作不能重复'),
});
const target = { taskId: TaskIdSchema, expectedGeneration: BusinessGenerationSchema, materialDigest: BusinessDigestSchema };
export const BusinessRecoveryTargetSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...target, action: z.literal('resume-task'), volumeUid: z.string().min(1).max(256) }),
  z.strictObject({ ...target, action: z.literal('rebuild-workspace'), volumeUid: z.string().min(1).max(256) }),
  z.strictObject({ ...target, action: z.literal('restart-task') }),
  z.strictObject({ ...target, action: z.literal('retry-subtask'), subtaskId: SubtaskIdSchema, expectedAttempt: BusinessGenerationSchema }),
  z.strictObject({ ...target, action: z.literal('resume-subtask'), subtaskId: SubtaskIdSchema, expectedAttempt: BusinessGenerationSchema, resumeSessionId: z.string().min(1).max(512) }),
]);
export const RequestBusinessRecoverySchema = z.strictObject({ requestKey: BusinessRequestKeySchema, target: BusinessRecoveryTargetSchema, assessmentDigest: BusinessDigestSchema });
export const BusinessRecoveryStateSchema = z.enum(['pending', 'claimed', 'running', 'succeeded', 'failed', 'rejected']);
export const BusinessRecoveryRequestSchema = z.strictObject({
  id: ResourceIdSchema, projectId: ProjectIdSchema, serviceId: ServiceIdSchema, requestedBy: UserIdSchema,
  requestKey: BusinessRequestKeySchema, target: BusinessRecoveryTargetSchema, assessmentDigest: BusinessDigestSchema,
  state: BusinessRecoveryStateSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  operationId: ResourceIdSchema.optional(), resultTaskId: TaskIdSchema.optional(), resultSubtaskId: SubtaskIdSchema.optional(), reason: z.string().max(1024).optional(),
});
export const BusinessRecoveryClaimSchema = z.strictObject({ fence: BusinessExecutionFenceSchema, requestId: ResourceIdSchema.optional() });
export const BusinessRecoveryReadSchema = z.strictObject({ fence: BusinessExecutionFenceSchema });
export const BusinessRecoveryRejectSchema = BusinessRecoveryReadSchema.extend({ claimId: ResourceIdSchema, reason: z.string().trim().min(1).max(1024) });
export const BusinessRecoveryClaimReceiptSchema = z.strictObject({ request: BusinessRecoveryRequestSchema, claimId: ResourceIdSchema, expiresAt: z.iso.datetime() });
export const BusinessRecoveryExecutionSchema = z.strictObject({ recoveryRequestId: ResourceIdSchema, claimId: ResourceIdSchema });
export const BusinessRecoveryAssessmentSchema = z.strictObject({
  taskId: TaskIdSchema, actions: z.array(z.strictObject({ target: BusinessRecoveryTargetSchema, assessmentDigest: BusinessDigestSchema })),
  reasons: z.array(z.string().max(128)),
});
export type BusinessRecoveryAction = z.infer<typeof BusinessRecoveryActionSchema>;
export type BusinessRecoveryTarget = z.infer<typeof BusinessRecoveryTargetSchema>;
export type RequestBusinessRecovery = z.infer<typeof RequestBusinessRecoverySchema>;
export type BusinessRecoveryRequest = z.infer<typeof BusinessRecoveryRequestSchema>;
export type BusinessRecoveryClaimReceipt = z.infer<typeof BusinessRecoveryClaimReceiptSchema>;
export type BusinessRecoveryAssessment = z.infer<typeof BusinessRecoveryAssessmentSchema>;
export type BusinessRecoveryExecution = z.infer<typeof BusinessRecoveryExecutionSchema>;
export type BusinessRecoveryClaim = z.infer<typeof BusinessRecoveryClaimSchema>;
export type BusinessRecoveryRead = z.infer<typeof BusinessRecoveryReadSchema>;
export type BusinessRecoveryReject = z.infer<typeof BusinessRecoveryRejectSchema>;
