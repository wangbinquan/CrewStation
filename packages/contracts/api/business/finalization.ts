import { z } from 'zod';
import type { ProjectId, ServiceId, TaskId, UserId } from '../../ids';
import type { BusinessTaskV3Dto } from './responses';
import { ProjectIdSchema, ResourceIdSchema, ServiceIdSchema, TaskIdSchema, UserIdSchema } from '../../ids';
import { BusinessTaskMutationSchema } from './requests';
import { ObjectDigestSchema, StorageBytesSchema, StorageRequestKeySchema, StorageRevisionSchema } from '../object-storage/values';
import { ArchivePlanEntrySchema, SealedArchivePlanSchema } from '../object-storage/archivePlans';

export const BusinessOutcomeSchema = z.enum(['succeeded', 'failed', 'cancelled']);
export const FinalizationPhaseSchema = z.enum(['requested', 'draining', 'archiving', 'archived', 'cleaning', 'completed']);
export const FinalizationPhaseStateSchema = z.enum(['pending', 'running', 'blocked', 'retrying', 'revising']);
export const FinalizationArchiveSchema = z.union([
  SealedArchivePlanSchema,
  z.strictObject({ noArtifactsReason: z.string().trim().min(1).max(1024) }),
]);
export const FinalizeBusinessTaskSchema = BusinessTaskMutationSchema.omit({ recovery: true }).extend({ outcome: BusinessOutcomeSchema, archive: FinalizationArchiveSchema });
export const ReviseBusinessArchiveSchema = z.strictObject({
  ...BusinessTaskMutationSchema.omit({ recovery: true, stopAuthority: true }).shape,
  expectedRevision: StorageRevisionSchema, archive: FinalizationArchiveSchema, reason: z.string().trim().min(1).max(1024),
  confirmDiscard: z.boolean().default(false),
});
export const AdministrativeFinalizationSchema = z.strictObject({
  requestKey: StorageRequestKeySchema, expectedGeneration: StorageRevisionSchema,
  outcome: BusinessOutcomeSchema, archive: FinalizationArchiveSchema, reason: z.string().trim().min(1).max(1024), confirmation: z.literal('finalize'),
});
export const ConfirmFinalizationLossSchema = z.strictObject({
  requestKey: StorageRequestKeySchema, expectedRevision: StorageRevisionSchema, assessmentDigest: ObjectDigestSchema,
  reason: z.string().trim().min(1).max(2048), confirmation: z.literal('accept-loss'),
});
export const ArchiveReceiptItemSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('saved'), name: z.string(), objectId: ResourceIdSchema, size: StorageBytesSchema, sha256: ObjectDigestSchema }),
  z.strictObject({ state: z.literal('omitted'), name: z.string(), reason: z.string() }),
  z.strictObject({ state: z.literal('lost'), name: z.string(), reason: z.string() }),
]);
export const ArchiveReceiptDtoSchema = z.strictObject({
  id: ResourceIdSchema, taskId: TaskIdSchema, finalizationId: ResourceIdSchema, taskGeneration: StorageRevisionSchema,
  finalizationRevision: StorageRevisionSchema, volumeUid: z.string().nullable(), manifestDigest: ObjectDigestSchema,
  disposition: z.enum(['archived', 'empty', 'never-provisioned', 'loss']), itemCount: StorageBytesSchema,
  noArtifactsReason: z.string().nullable(), lossActorId: UserIdSchema.nullable(), lossReason: z.string().nullable(), createdAt: z.iso.datetime(),
});
export const BusinessFinalizationDtoSchema = z.strictObject({
  operationId: ResourceIdSchema, taskId: TaskIdSchema, revision: StorageRevisionSchema, taskGeneration: StorageRevisionSchema,
  outcome: BusinessOutcomeSchema, phase: FinalizationPhaseSchema, phaseState: FinalizationPhaseStateSchema,
  errorCode: z.string().nullable(), message: z.string().nullable(), retryable: z.boolean(), nextRetryAt: z.iso.datetime().nullable(),
  receipt: ArchiveReceiptDtoSchema.nullable(), computeStopped: z.boolean(), artifactsReady: z.boolean(),
  volumeDisposition: z.enum(['pending', 'deleted', 'never-provisioned', 'lost', 'unknown']), storageReclaimed: z.boolean().nullable(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});

export type BusinessOutcome = z.infer<typeof BusinessOutcomeSchema>;
export type FinalizationPhase = z.infer<typeof FinalizationPhaseSchema>;
export type FinalizationPhaseState = z.infer<typeof FinalizationPhaseStateSchema>;
export type FinalizationArchive = z.infer<typeof FinalizationArchiveSchema>;
export type FinalizeBusinessTask = z.infer<typeof FinalizeBusinessTaskSchema>;
export type ReviseBusinessArchive = z.infer<typeof ReviseBusinessArchiveSchema>;
export const OperatorArchivePlanSchema = z.strictObject({ requestKey: StorageRequestKeySchema, entries: z.array(ArchivePlanEntrySchema).min(1).max(100), reason: z.string().trim().min(1).max(1024) });
export const AdministrativeArchiveRevisionSchema = ReviseBusinessArchiveSchema.omit({ fence: true });
export type OperatorArchivePlan = z.infer<typeof OperatorArchivePlanSchema>;
export type AdministrativeArchiveRevision = z.infer<typeof AdministrativeArchiveRevisionSchema>;
export type AdministrativeFinalization = z.infer<typeof AdministrativeFinalizationSchema>;
export type ConfirmFinalizationLoss = z.infer<typeof ConfirmFinalizationLossSchema>;
export type ArchiveReceiptItem = z.infer<typeof ArchiveReceiptItemSchema>;
export type ArchiveReceiptDto = z.infer<typeof ArchiveReceiptDtoSchema>;
export type BusinessFinalizationDto = z.infer<typeof BusinessFinalizationDtoSchema>;
export const BusinessTaskStorageDetailSchema = z.strictObject({
  taskId: TaskIdSchema, projectId: ProjectIdSchema, serviceId: ServiceIdSchema,
  completionPolicy: z.enum(['legacy', 'archive-and-delete']), canOperateStorage: z.boolean().default(false), finalization: BusinessFinalizationDtoSchema.nullable(),
});
export type BusinessTaskStorageDetail = z.infer<typeof BusinessTaskStorageDetailSchema>;
export interface BusinessStoragePreview {
  task: BusinessTaskV3Dto;
  projectId: ProjectId;
  activeExecutions: number;
  unknownExecutions: number;
  finalization: BusinessFinalizationDto | null;
}

/** Internal immutable intake projection. Data fetches this from business; HTTP callers never submit it. */
export const AcceptedArchiveFinalizationSchema = z.strictObject({
  id: ResourceIdSchema, projectId: ProjectIdSchema, serviceId: ServiceIdSchema, spaceId: ResourceIdSchema,
  taskId: TaskIdSchema, taskGeneration: StorageRevisionSchema, volumeUid: z.uuid().nullable(),
  outcome: BusinessOutcomeSchema, archive: FinalizationArchiveSchema,
});
export type AcceptedArchiveFinalization = z.infer<typeof AcceptedArchiveFinalizationSchema>;

/** Durable authority fetched by data; never an HTTP request body. */
export interface AcceptedArchiveRevision {
  readonly id: string; readonly finalizationId: string; readonly projectId: ProjectId; readonly serviceId: ServiceId;
  readonly taskId: TaskId; readonly spaceId: string; readonly input: Omit<ReviseBusinessArchive, 'fence'>;
  readonly actor: { readonly userId: UserId; readonly reason: string } | { readonly podUid: string; readonly epoch: number | null };
}
