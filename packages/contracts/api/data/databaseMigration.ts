import { z } from 'zod';
import { ProjectIdSchema, ReleaseIdSchema, ResourceIdSchema, UserIdSchema, ServiceIdSchema } from '../../ids';
import { DatabaseRestoreJobReceiptSchema, ServiceDatabaseRestoreSchema } from './databaseRestore';
/** `servicePlanId`: the plan the migration Jobs run with, when the conversion needs more than the service itself (RFC-044 T9); the service's plan otherwise. */
export const ServiceDatabaseMigrationSchema = ServiceDatabaseRestoreSchema.extend({ sourceKeyConfig: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(), servicePlanId: ResourceIdSchema.optional() });
export const DatabaseMigrationDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const DatabaseMigrationOperationIdSchema = z.string().regex(/^dbm_e2_[A-Za-z0-9_-]{8,128}$/);
export const DatabaseMigrationStageSchema = z.enum(['requested','provisioning','building','planning','awaiting-approval','approved','freezing','migrating','awaiting-reapproval','activating','verifying','ready-to-open','opening','completing','completed','rolling-back','rolled-back','abandoned']);
export const DatabaseMigrationActionSchema = z.enum(['replan','approve','switch','open','rollback','retry','abandon']);
export const DatabaseMigrationJobPurposeSchema = z.enum(['database-migration-plan','database-migration-run','database-migration-verify','database-migration-rollback','database-migration-complete']);
export const DATABASE_MIGRATION_ERRORS = {
  active: 'database_migration_active', unsupported: 'database_migration_unsupported', restoreUnsupported: 'database_migration_restore_unsupported',
  staleRevision: 'stale_revision', approvalMismatch: 'database_migration_approval_mismatch', confirmationMismatch: 'database_migration_confirmation_mismatch',
  planBlocked: 'database_migration_plan_blocked', receiptMismatch: 'database_migration_receipt_mismatch', writeOnceConflict: 'write-once-conflict',
  opened: 'database_migration_opened', invalidStage: 'database_migration_invalid_stage',
} as const;
export const CreateDatabaseMigrationSchema = z.strictObject({ requestId: ResourceIdSchema, expectedActiveReleaseId: ReleaseIdSchema, expectedActiveGenerationId: ResourceIdSchema, branch: z.string().min(1).max(256), expectedCommitSha: z.string().regex(/^[a-f0-9]{40}$/) });
export const RetryDatabaseMigrationSchema = z.strictObject({ expectedRevision: z.number().int().positive() });
export const ReplanDatabaseMigrationSchema = RetryDatabaseMigrationSchema;
export const AbandonDatabaseMigrationSchema = RetryDatabaseMigrationSchema;
export const RollbackDatabaseMigrationSchema = RetryDatabaseMigrationSchema;
export const ApproveDatabaseMigrationSchema = RetryDatabaseMigrationSchema.extend({ approvalDigest: DatabaseMigrationDigestSchema });
export const SwitchDatabaseMigrationSchema = RetryDatabaseMigrationSchema.extend({ confirmationDigest: z.string().regex(/^[a-f0-9]{64}$/) });
export const OpenDatabaseMigrationSchema = SwitchDatabaseMigrationSchema;
/** Application-owned evidence is retained verbatim; the platform validates the orchestration fields. */
export const DatabaseMigrationPlanSchema = z.strictObject({
  payload: z.looseObject({ source: z.record(z.string(), z.json()), target: z.looseObject({ generationId: z.string().min(1), location: z.record(z.string(), z.json()) }), blocks: z.array(z.json()), estimates: z.record(z.string(), z.json()).optional() }),
  digest: DatabaseMigrationDigestSchema, approvalDigest: DatabaseMigrationDigestSchema,
});
export const DatabaseMigrationPlanViewSchema = z.strictObject({ operationId: DatabaseMigrationOperationIdSchema, plan: DatabaseMigrationPlanSchema, jsonPath: z.string().nullable(), markdownPath: z.string().nullable(), acknowledgeable: z.array(z.json()), requiresApproval: z.boolean(), guidance: z.array(z.json()) });
export const DatabaseMigrationApprovalRequestSchema = z.strictObject({ operationId: DatabaseMigrationOperationIdSchema, runId: z.string(), planDigest: DatabaseMigrationDigestSchema, approvalDigest: DatabaseMigrationDigestSchema, planPath: z.string().nullable() });
export const DatabaseMigrationReceiptSchema = z.strictObject({ payload: z.looseObject({ operationId: DatabaseMigrationOperationIdSchema }), digest: DatabaseMigrationDigestSchema });
export const DatabaseMigrationAttemptSchema = z.strictObject({ jobId: ResourceIdSchema, purpose: DatabaseMigrationJobPurposeSchema, receipt: DatabaseRestoreJobReceiptSchema.nullable(), logTail: z.string(), receiptDigest: DatabaseMigrationDigestSchema.nullable() });
export const DatabaseMigrationDtoSchema = z.strictObject({
  id: ResourceIdSchema, projectId: ProjectIdSchema, serviceId: ServiceIdSchema, revision: z.number().int().positive(), stage: DatabaseMigrationStageSchema,
  sourceGenerationId: ResourceIdSchema, targetGenerationId: ResourceIdSchema, scratchGenerationId: ResourceIdSchema, sourceReleaseId: ReleaseIdSchema, candidateReleaseId: ReleaseIdSchema,
  branch: z.string(), commitSha: z.string(), candidateTag: z.string(), image: z.string().nullable(), plan: DatabaseMigrationPlanViewSchema.nullable(),
  approval: z.strictObject({ digest: DatabaseMigrationDigestSchema, by: UserIdSchema, at: z.iso.datetime() }).nullable(),
  confirmationDigest: z.string().nullable(), actions: z.array(DatabaseMigrationActionSchema), blockedReason: z.string().nullable(), error: z.string().nullable(),
  observation: z.strictObject({ message: z.string(), at: z.iso.datetime(), failures: z.number().int().positive() }).nullable(),
  attempts: z.array(DatabaseMigrationAttemptSchema), createdBy: UserIdSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
export const DatabaseMigrationListSchema = z.strictObject({ items: z.array(DatabaseMigrationDtoSchema) });
export type DatabaseMigrationDto = z.infer<typeof DatabaseMigrationDtoSchema>;
export type DatabaseMigrationStage = z.infer<typeof DatabaseMigrationStageSchema>;
export type DatabaseMigrationAction = z.infer<typeof DatabaseMigrationActionSchema>;
export type DatabaseMigrationJobPurpose = z.infer<typeof DatabaseMigrationJobPurposeSchema>;
export type DatabaseMigrationPlanView = z.infer<typeof DatabaseMigrationPlanViewSchema>;
export type DatabaseMigrationReceipt = z.infer<typeof DatabaseMigrationReceiptSchema>;
export type CreateDatabaseMigration = z.infer<typeof CreateDatabaseMigrationSchema>;
export type RetryDatabaseMigration = z.infer<typeof RetryDatabaseMigrationSchema>;
export type ApproveDatabaseMigration = z.infer<typeof ApproveDatabaseMigrationSchema>;
export type SwitchDatabaseMigration = z.infer<typeof SwitchDatabaseMigrationSchema>;
