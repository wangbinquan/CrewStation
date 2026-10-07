import { pgSchema, text, timestamp, bigint, boolean, integer, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";
import { jsonDocument } from "@crewstation/persistence";
import type { UsageRecord, UsageObservation, UsageValuation, UsageNativeCapture, RunnerUsageMeasurement, TokenPriceVersion, ExecutionCostVisibilityDto } from "@crewstation/contracts";
import type { UsageEvidence, NativeCaptureDocument, NativeBaselineEntry, NativeRepair } from "../../domain/usageProjection";
import type { NativeLedgerReference } from '../../domain/developmentUsage/nativeLedgerReference';
import type { AcceptedExecutionPrice } from "../../ports/tokenPricing";
import type { DevelopmentModelEvidence } from "../../domain/developmentNative";

/** 本模块唯一允许使用的 PostgreSQL schema；所有表都定义在它之下。 */
export const observabilitySchema = pgSchema('observability');

export const alerts = observabilitySchema.table('alerts', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  type: text('type').notNull(),
  key: text('key').notNull(),
  state: text('state').notNull(),
  detail: text('detail').notNull(),
  firedAt: timestamp('fired_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const usageHeads = observabilitySchema.table('usage_heads', {
  taskKey: text('task_key').primaryKey(), projectId: text('project_id').notNull(), taskId: text('task_id').notNull(),
  sequence: bigint('sequence', { mode: 'number' }).notNull(),
  nativeRevision: text('native_revision').notNull().default('0'),
});
export const usageSources = observabilitySchema.table('usage_sources', {
  taskKey: text('task_key').notNull(), sourceId: text('source_id').notNull(), cursor: text('cursor'),
}, (t) => [primaryKey({ columns: [t.taskKey, t.sourceId] })]);
export const usagePages = observabilitySchema.table('usage_pages', {
  taskKey: text('task_key').notNull(), sourceId: text('source_id').notNull(), cursor: text('cursor').notNull(), fingerprint: text('fingerprint').notNull(),
}, (t) => [primaryKey({ columns: [t.taskKey, t.sourceId, t.cursor] })]);
export const usageEvents = observabilitySchema.table('usage_events', {
  taskKey: text('task_key').notNull(), sourceId: text('source_id').notNull(), eventId: text('event_id').notNull(), fingerprint: text('fingerprint').notNull(),
}, (t) => [primaryKey({ columns: [t.taskKey, t.sourceId, t.eventId] })]);
export const usageEvidence = observabilitySchema.table('usage_evidence', {
  meterKey: text('meter_key').notNull(), revision: bigint('revision', { mode: 'number' }).notNull(),
  fingerprint: text('fingerprint').notNull(), document: jsonDocument('document').$type<UsageEvidence>().notNull(),
}, (t) => [primaryKey({ columns: [t.meterKey, t.revision] })]);
export const usageProjections = observabilitySchema.table('usage_projections', {
  meterKey: text('meter_key').primaryKey(), taskKey: text('task_key').notNull(),
  document: jsonDocument('document').$type<UsageRecord>().notNull(),
}, (t) => [index('usage_projection_task').on(t.taskKey, t.meterKey)]);
export const usageChanges = observabilitySchema.table('usage_changes', {
  taskKey: text('task_key').notNull(), sequence: bigint('sequence', { mode: 'number' }).notNull(), meterKey: text('meter_key').notNull(),
  document: jsonDocument('document').$type<UsageObservation>().notNull(),
}, (t) => [primaryKey({ columns: [t.taskKey, t.sequence] }), index('usage_change_meter').on(t.taskKey, t.meterKey, t.sequence)]);

export const usageSnapshots = observabilitySchema.table('usage_snapshots', {
  id: text('id').primaryKey(), taskKey: text('task_key').notNull(),
  through: bigint('through', { mode: 'number' }).notNull(), visibilityRevision: bigint('visibility_revision', { mode: 'number' }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(), expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
}, (t) => [index('usage_snapshot_expiry').on(t.expiresAt)]);

export const executionValuations = observabilitySchema.table('execution_valuations', {
  meterKey: text('meter_key').primaryKey(), taskKey: text('task_key').notNull(), basisFingerprint: text('basis_fingerprint').notNull(),
  document: jsonDocument('document').$type<UsageValuation>().notNull(),
});
export const executionValuationReceipts = observabilitySchema.table('execution_valuation_receipts', {
  taskKey: text('task_key').notNull(), requestKey: text('request_key').notNull(), fingerprint: text('fingerprint').notNull(),
  document: jsonDocument('document').$type<UsageValuation>().notNull(),
}, (t) => [primaryKey({ columns: [t.taskKey, t.requestKey] })]);


export const nativeCaptures = observabilitySchema.table('native_captures', {
  id: text('id').primaryKey(), taskKey: text('task_key').notNull(), sourceId: text('source_id').notNull(), turn: text('turn').notNull(),
  lineageKey: text('lineage_key').notNull(), root: text('root'), finalized: boolean('finalized').notNull(),
  document: jsonDocument('document').$type<NativeCaptureDocument>().notNull(), summary: jsonDocument('summary').$type<UsageNativeCapture>().notNull(),
}, (t) => [index('native_capture_task').on(t.taskKey, t.id), index('native_capture_turn').on(t.taskKey, t.sourceId, t.turn)]);
export const nativeCaptureHistory = observabilitySchema.table('native_capture_history', {
  taskKey: text('task_key').notNull(), sequence: bigint('sequence', { mode: 'number' }).notNull(), captureId: text('capture_id').notNull(),
  document: jsonDocument('document').$type<UsageNativeCapture>().notNull(),
}, (t) => [primaryKey({ columns: [t.taskKey, t.sequence] }), index('native_capture_boundary').on(t.taskKey, t.captureId, t.sequence)]);
export const nativeSteps = observabilitySchema.table('native_steps', {
  captureId: text('capture_id').notNull(), recordId: text('record_id').notNull(), taskKey: text('task_key').notNull(), nativeKey: text('native_key').notNull(),
  modelEvidence: jsonDocument('model_evidence').$type<RunnerUsageMeasurement>(),
  root: text('root').notNull(), revision: bigint('revision', { mode: 'number' }).notNull(), fingerprint: text('fingerprint').notNull(),
}, (t) => [primaryKey({ columns: [t.captureId, t.recordId] }), index('native_step_owner').on(t.taskKey, t.nativeKey, t.captureId)]);
export const nativeBaselines = observabilitySchema.table('native_baselines', {
  captureId: text('capture_id').notNull(), ordinal: integer('ordinal').notNull(), taskKey: text('task_key').notNull(), nativeKey: text('native_key').notNull(),
  document: jsonDocument('document').$type<NativeBaselineEntry>().notNull(), status: text('status').notNull(), ownerId: text('owner_id'),
}, (t) => [primaryKey({ columns: [t.captureId, t.ordinal] }), index('native_baseline_owner').on(t.taskKey, t.nativeKey, t.captureId)]);

export const nativeRepairs = observabilitySchema.table('native_repairs', {
  meterKey: text('meter_key').primaryKey(), taskKey: text('task_key').notNull(), nativeKey: text('native_key').notNull(),
  valuationKey: text('valuation_key').notNull(), active: boolean('active').notNull(), document: jsonDocument('document').$type<NativeRepair | NativeLedgerReference>().notNull(),
}, (t) => [index('native_repair_key').on(t.taskKey, t.nativeKey)]);

export const tokenPriceHeads = observabilitySchema.table('token_price_heads', {
  profileId: text('profile_id').primaryKey(), revision: integer('revision').notNull(),
});
export const tokenPrices = observabilitySchema.table('token_prices', {
  profileId: text('profile_id').notNull(), revision: integer('revision').notNull(),
  id: text('id').notNull(), requestKey: text('request_key').notNull(),
  fingerprint: text('fingerprint').notNull(),
  profileRevision: integer('profile_revision').notNull(), protocol: text('protocol').notNull(),
  provider: text('provider').notNull(), model: text('model').notNull(),
  condition: text('condition'), effectiveFrom: text('effective_from').notNull(),
  document: jsonDocument('document').$type<TokenPriceVersion>().notNull(),
}, (table) => [
  primaryKey({ columns: [table.profileId, table.revision] }),
  uniqueIndex('token_price_request_key').on(table.profileId, table.requestKey),
  uniqueIndex('token_price_id').on(table.id),
]);

export const costVisibility = observabilitySchema.table('cost_visibility', {
  projectId: text('project_id').primaryKey(), revision: bigint('revision', { mode: 'number' }).notNull(),
  document: jsonDocument('document').$type<ExecutionCostVisibilityDto>().notNull(),
});
export const costVisibilityReceipts = observabilitySchema.table('cost_visibility_receipts', {
  projectId: text('project_id').notNull(), requestKey: text('request_key').notNull(), fingerprint: text('fingerprint').notNull(),
  document: jsonDocument('document').$type<ExecutionCostVisibilityDto>().notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.requestKey] })]);

export const acceptedExecutionPrices = observabilitySchema.table('accepted_execution_prices', {
  executionId: text('execution_id').notNull(), generation: bigint('generation', { mode: 'number' }).notNull(),
  fingerprint: text('fingerprint').notNull(), document: jsonDocument('document').$type<AcceptedExecutionPrice>().notNull(),
}, (t) => [primaryKey({ columns: [t.executionId, t.generation] })]);

/** Numeric evidence and prices remain in their existing tables. */
export const developmentModelEvidence = observabilitySchema.table('development_model_evidence', {
  meterKey: text('meter_key').notNull(), revision: bigint('revision', { mode: 'number' }).notNull(),
  fingerprint: text('fingerprint').notNull(), document: jsonDocument('document').$type<DevelopmentModelEvidence>().notNull(),
}, (t) => [primaryKey({ columns: [t.meterKey, t.revision] })]);
