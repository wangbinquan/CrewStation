import { z } from 'zod';
import { ResourceIdSchema, TraceIdSchema } from '../../ids';
import { VolumeModeSchema } from '../../manifest/tasks';
import { BusinessExecutionFenceSchema } from './control';
import { BusinessRecoveryExecutionSchema } from './recovery';
import { BusinessCwdSchema, BusinessEnvironmentNameSchema, BusinessGenerationSchema, BusinessRequestKeySchema, BusinessTaskContractVersionSchema } from './executionValues';

const mutation = { requestKey: BusinessRequestKeySchema, fence: BusinessExecutionFenceSchema.optional() };
export const CreateBusinessTaskV3Schema = z.strictObject({
  ...mutation, taskContractVersion: BusinessTaskContractVersionSchema,
  runtimeImageVersionId: ResourceIdSchema.optional(),
  volumeMode: VolumeModeSchema.optional(), taskProfileId: ResourceIdSchema.optional(), traceId: TraceIdSchema.optional(),
  labels: z.record(z.string().min(1).max(128), z.string().max(1024)).default({}),
});

export const BusinessCommandEnvironmentSchema = z.record(BusinessEnvironmentNameSchema, z.string().max(32768).refine((value) => !value.includes('\0'), '环境变量值不能含 NUL'));
const invocation = { ...mutation, name: z.string().trim().min(1).max(80), cwd: BusinessCwdSchema.optional() };
export const SubmitBusinessSubtaskV3Schema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...invocation, kind: z.literal('agent'), agentProfileId: ResourceIdSchema, outputContractId: ResourceIdSchema.optional(),
    runtimeImageVersionId: ResourceIdSchema.optional(),
    prompt: z.string().min(1).max(1024 * 1024), mode: z.enum(['oneshot', 'interactive']).default('oneshot'),
    materialId: ResourceIdSchema.optional(), resumeSessionId: z.string().min(1).max(512).optional(),
  }),
  z.strictObject({
    ...invocation, kind: z.literal('command'), argv: z.array(z.string().max(32768).refine((value) => !value.includes('\0'), '命令参数不能含 NUL')).min(1).max(1024),
    env: BusinessCommandEnvironmentSchema.default({}), timeoutSeconds: z.number().int().min(1).max(86400).default(3600),
  }).refine((value) => (value.argv[0]?.length ?? 0) > 0, '命令名不能为空'),
]);

const retry = { ...mutation, expectedAttempt: BusinessGenerationSchema, recovery: BusinessRecoveryExecutionSchema.optional() };
export const RetryBusinessSubtaskV3Schema = z.discriminatedUnion('resumePolicy', [
  z.strictObject({ ...retry, resumePolicy: z.literal('fresh') }),
  z.strictObject({ ...retry, resumePolicy: z.literal('resume'), resumeSessionId: z.string().min(1).max(512) }),
]);
export const BusinessStopAuthoritySchema = z.strictObject({ operationId: ResourceIdSchema, epoch: BusinessGenerationSchema });
export const BusinessSubtaskMutationSchema = z.strictObject({ ...mutation, stopAuthority: BusinessStopAuthoritySchema.optional(), expectedAttempt: BusinessGenerationSchema });
export const BusinessSubtaskMessageV3Schema = BusinessSubtaskMutationSchema.omit({ stopAuthority: true }).extend({ content: z.string().min(1).max(1024 * 1024) });
export const BusinessTaskMutationSchema = z.strictObject({ ...mutation, stopAuthority: BusinessStopAuthoritySchema.optional(), expectedGeneration: BusinessGenerationSchema, recovery: BusinessRecoveryExecutionSchema.optional() });

export type CreateBusinessTaskV3 = z.infer<typeof CreateBusinessTaskV3Schema>;
export type SubmitBusinessSubtaskV3 = z.infer<typeof SubmitBusinessSubtaskV3Schema>;
export type RetryBusinessSubtaskV3 = z.infer<typeof RetryBusinessSubtaskV3Schema>;
export type BusinessSubtaskMutation = z.infer<typeof BusinessSubtaskMutationSchema>;
export type BusinessSubtaskMessageV3 = z.infer<typeof BusinessSubtaskMessageV3Schema>;
export type BusinessTaskMutation = z.infer<typeof BusinessTaskMutationSchema>;

export type CreateBusinessTaskV3Input = z.input<typeof CreateBusinessTaskV3Schema>;
export type SubmitBusinessSubtaskV3Input = z.input<typeof SubmitBusinessSubtaskV3Schema>;
export type RetryBusinessSubtaskV3Input = z.input<typeof RetryBusinessSubtaskV3Schema>;
export type BusinessTaskMutationInput = z.input<typeof BusinessTaskMutationSchema>;
export type BusinessSubtaskMutationInput = z.input<typeof BusinessSubtaskMutationSchema>;
export type BusinessSubtaskMessageV3Input = z.input<typeof BusinessSubtaskMessageV3Schema>;
