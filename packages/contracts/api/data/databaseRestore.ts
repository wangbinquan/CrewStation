import { z } from 'zod';
import { ProjectIdSchema, ReleaseIdSchema, ResourceIdSchema, ServiceIdSchema, UserIdSchema } from '../../ids';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const command = z.array(z.string().min(1).max(4096).refine((value) => !value.includes('\0'))).min(1).max(64);
/** Fixed in the approved release; no operator-supplied shell, DSN or environment. */
export const ServiceDatabaseRestoreSchema = z.strictObject({ command, verifyCommand: command });
export const DatabasePhysicalIdentitySchema = z.strictObject({ serverId: z.string().min(1).max(128), databaseOid: z.string().regex(/^[0-9]+$/), roleOid: z.string().regex(/^[0-9]+$/) });
export type DatabasePhysicalIdentity = z.infer<typeof DatabasePhysicalIdentitySchema>;
export const DatabaseGenerationDtoSchema = z.strictObject({
  id: ResourceIdSchema, resourceId: ResourceIdSchema, projectId: ProjectIdSchema, serviceId: ServiceIdSchema,
  env: z.enum(['production', 'development']), state: z.enum(['provisioning', 'ready', 'active', 'retained']), origin: z.enum(['existing', 'restore', 'migration', 'migration-scratch']),
  migrationOperationId: ResourceIdSchema.nullable().optional(),
  restoreOperationId: ResourceIdSchema.nullable(), identity: DatabasePhysicalIdentitySchema.nullable(), createdAt: z.iso.datetime(),
});
export const DatabaseBindingDtoSchema = z.strictObject({ generationId: ResourceIdSchema, revision: z.number().int().positive(), migrationOperationId: ResourceIdSchema.nullable().optional(), restoreOperationId: ResourceIdSchema.nullable() });
export const DatabaseGenerationListSchema = z.strictObject({ active: DatabaseBindingDtoSchema, items: z.array(DatabaseGenerationDtoSchema) });
/** `abandoned` ends a restore that never switched: reservations and holds are released, the target database is retained. */
export const DatabaseRestoreStageSchema = z.enum(['requested', 'provisioning', 'restoring', 'verifying', 'ready-to-switch', 'freezing', 'deploying', 'switching', 'completed', 'abandoned']);
/**
 * The backup reference is injected verbatim as `CS_DATABASE_RESTORE_REFERENCE`; `backupReferenceDigest` is SHA-256 of its exact
 * UTF-8 bytes. Surrounding whitespace is rejected so trimming consumers derive the same digest.
 */
export const CreateDatabaseRestoreSchema = z.strictObject({
  requestId: ResourceIdSchema, expectedActiveGenerationId: ResourceIdSchema, expectedActiveReleaseId: ReleaseIdSchema, restoreReleaseId: ReleaseIdSchema,
  backupReference: z.string().min(1).max(2048).refine((value) => !/[\r\n\0]/.test(value) && value === value.trim(), '备份引用不能含换行、NUL 或首尾空白'),
});
/** App verification cannot attest physical target identity; that comes from platform observations. */
export const DatabaseRestoreVerificationSchema = z.strictObject({
  version: z.literal(1), backupReferenceDigest: sha256, schemaDigest: z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/), complete: z.literal(true), autoResumeSuspended: z.literal(true),
});
/** `failure` names why a terminal attempt failed without a usable exit; every failed attempt can be retried in the same operation. */
export const DatabaseRestoreJobFailureSchema = z.enum(['exit', 'deadline-exceeded', 'job-lost', 'pod-missing', 'receipt-invalid', 'receipt-mismatch']);
export const DatabaseRestoreJobReceiptSchema = z.strictObject({
  name: z.string().min(1), uid: z.string().min(1), image: z.string().regex(/@sha256:[a-f0-9]{64}$/),
  target: DatabasePhysicalIdentitySchema, state: z.enum(['pending', 'running', 'succeeded', 'failed']), exitCode: z.number().int().nullable(),
  failure: DatabaseRestoreJobFailureSchema.optional(),
});
export const DatabaseRestoreDtoSchema = z.strictObject({
  id: ResourceIdSchema, projectId: ProjectIdSchema, serviceId: ServiceIdSchema, revision: z.number().int().positive(), stage: DatabaseRestoreStageSchema,
  sourceGenerationId: ResourceIdSchema, targetGenerationId: ResourceIdSchema, sourceReleaseId: ReleaseIdSchema, restoreReleaseId: ReleaseIdSchema,
  image: z.string().regex(/@sha256:[a-f0-9]{64}$/), backupReference: z.string(), backupReferenceDigest: sha256,
  createdBy: UserIdSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  previousAttempts: z.array(z.strictObject({jobId: ResourceIdSchema, purpose: z.enum(['database-restore','database-verify']), receipt: DatabaseRestoreJobReceiptSchema})),
  restoreJob: DatabaseRestoreJobReceiptSchema.nullable(), verifyJob: DatabaseRestoreJobReceiptSchema.nullable(), verification: DatabaseRestoreVerificationSchema.nullable(),
  confirmationDigest: sha256.nullable(), actions: z.array(z.enum(['retry', 'switch', 'abandon'])), blockedReason: z.string().nullable(), error: z.string().nullable(),
  /** Transient observation failure the platform keeps retrying by itself; not a blocked state. */
  observation: z.strictObject({ message: z.string(), at: z.iso.datetime(), failures: z.number().int().positive() }).nullable().optional(),
  abandonedBy: UserIdSchema.nullable().optional(), abandonedAt: z.iso.datetime().nullable().optional(),
});
export const DatabaseRestoreListSchema = z.strictObject({ items: z.array(DatabaseRestoreDtoSchema) });
export const RetryDatabaseRestoreSchema = z.strictObject({ expectedRevision: z.number().int().positive() });
export const SwitchDatabaseRestoreSchema = RetryDatabaseRestoreSchema.extend({ confirmationDigest: sha256 });
export const AbandonDatabaseRestoreSchema = RetryDatabaseRestoreSchema;
export type DatabaseGenerationDto = z.infer<typeof DatabaseGenerationDtoSchema>;
export type DatabaseBindingDto = z.infer<typeof DatabaseBindingDtoSchema>;
export type DatabaseGenerationList = z.infer<typeof DatabaseGenerationListSchema>;
export type DatabaseRestoreDto = z.infer<typeof DatabaseRestoreDtoSchema>;
export type DatabaseRestoreStage = z.infer<typeof DatabaseRestoreStageSchema>;
export type DatabaseRestoreVerification = z.infer<typeof DatabaseRestoreVerificationSchema>;
export type DatabaseRestoreJobReceipt = z.infer<typeof DatabaseRestoreJobReceiptSchema>;
export type CreateDatabaseRestore = z.infer<typeof CreateDatabaseRestoreSchema>;
export type RetryDatabaseRestore = z.infer<typeof RetryDatabaseRestoreSchema>;
export type SwitchDatabaseRestore = z.infer<typeof SwitchDatabaseRestoreSchema>;
export type AbandonDatabaseRestore = z.infer<typeof AbandonDatabaseRestoreSchema>;
export type DatabaseRestoreJobFailure = z.infer<typeof DatabaseRestoreJobFailureSchema>;
