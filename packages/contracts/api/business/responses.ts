import { z } from 'zod';
import { RuntimeImageExecutionSnapshotSchema } from '../runtimeImages/responses';
import { ReleaseIdSchema, ResourceIdSchema, ServiceIdSchema, SubtaskIdSchema, TaskIdSchema, TraceIdSchema } from '../../ids';
import { VolumeModeSchema } from '../../manifest/tasks';
import { BusinessResultSchema } from './events';
import { BusinessDigestSchema, BusinessGenerationSchema, BusinessProcessStateSchema, BusinessSubtaskStateV3Schema, BusinessTaskContractVersionSchema, BusinessTaskStateV3Schema } from './executionValues';

export const BusinessTaskV3DtoSchema = z.strictObject({
  image: z.string().optional(),
  runtimeImage: RuntimeImageExecutionSnapshotSchema.optional(),
  id: TaskIdSchema, serviceId: ServiceIdSchema, state: BusinessTaskStateV3Schema, releaseId: ReleaseIdSchema,
  taskContractVersion: BusinessTaskContractVersionSchema, contractDigest: BusinessDigestSchema,
  generation: BusinessGenerationSchema, volumeMode: VolumeModeSchema, volumeUid: z.string().nullable(),
  taskProfileId: ResourceIdSchema, traceId: TraceIdSchema, labels: z.record(z.string(), z.string()),
  resourceState: z.enum(['admitting', 'creating', 'ready', 'releasing', 'released', 'unknown', 'failed']),
  quotaHeld: z.boolean().nullable(), message: z.string().optional(), createdAt: z.iso.datetime(), closedAt: z.iso.datetime().optional(),
});
export const BusinessSubtaskV3DtoSchema = z.strictObject({
  image: z.string().optional(),
  runtimeImage: RuntimeImageExecutionSnapshotSchema.optional(),
  id: SubtaskIdSchema, taskId: TaskIdSchema, name: z.string(), kind: z.enum(['agent', 'command']),
  attempt: BusinessGenerationSchema, previousId: SubtaskIdSchema.optional(), state: BusinessSubtaskStateV3Schema, process: BusinessProcessStateSchema,
  executionId: ResourceIdSchema, agentProfileId: ResourceIdSchema.optional(), computeProfileId: ResourceIdSchema.optional(), profileRevision: BusinessGenerationSchema.optional(),
  materialDigest: BusinessDigestSchema.optional(), sessionId: z.string().optional(), result: BusinessResultSchema.optional(),
  error: z.strictObject({ code: z.string(), message: z.string() }).optional(),
  cancelRequestedAt: z.iso.datetime().optional(), createdAt: z.iso.datetime(), startedAt: z.iso.datetime().optional(), endedAt: z.iso.datetime().optional(),
});
export const BusinessOperationDtoSchema = z.strictObject({
  operationId: ResourceIdSchema, taskId: TaskIdSchema, subtaskId: SubtaskIdSchema.optional(),
  state: z.enum(['admitting', 'pending', 'running', 'succeeded', 'failed', 'retryable-rejected']),
  resourceId: ResourceIdSchema.optional(), message: z.string().optional(),
});
export const BusinessOutputDtoSchema = z.strictObject({ stdout: z.string(), stderr: z.string(), truncated: z.boolean(), resultRef: z.string().nullable() });

export type BusinessTaskV3Dto = z.infer<typeof BusinessTaskV3DtoSchema>;
export type BusinessSubtaskV3Dto = z.infer<typeof BusinessSubtaskV3DtoSchema>;
export type BusinessOperationDto = z.infer<typeof BusinessOperationDtoSchema>;
export type BusinessOutputDto = z.infer<typeof BusinessOutputDtoSchema>;
