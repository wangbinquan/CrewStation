import { bigint, text, primaryKey, index } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { ExecutionUsageObservation, ExecutionObservation, ExecutionValuationObservation } from '@crewstation/contracts';
import type { UsageEvidence } from '../../domain/usageProjection';
import { observabilitySchema } from './schema';

export const usageHeads = observabilitySchema.table('usage_heads', {
  taskKey: text('task_key').primaryKey(), projectId: text('project_id').notNull(), taskId: text('task_id').notNull(),
  sequence: bigint('sequence', { mode: 'number' }).notNull(),
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
  document: jsonDocument('document').$type<ExecutionUsageObservation>().notNull(),
}, (t) => [index('usage_projection_task').on(t.taskKey, t.meterKey)]);
export const usageChanges = observabilitySchema.table('usage_changes', {
  taskKey: text('task_key').notNull(), sequence: bigint('sequence', { mode: 'number' }).notNull(), meterKey: text('meter_key').notNull(),
  document: jsonDocument('document').$type<ExecutionObservation>().notNull(),
}, (t) => [primaryKey({ columns: [t.taskKey, t.sequence] }), index('usage_change_meter').on(t.taskKey, t.meterKey, t.sequence)]);

export const usageSnapshots = observabilitySchema.table('usage_snapshots', {
  id: text('id').primaryKey(), taskKey: text('task_key').notNull(),
  through: bigint('through', { mode: 'number' }).notNull(), visibilityRevision: bigint('visibility_revision', { mode: 'number' }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(), expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
}, (t) => [index('usage_snapshot_expiry').on(t.expiresAt)]);

export const executionValuations = observabilitySchema.table('execution_valuations', {
  meterKey: text('meter_key').primaryKey(), taskKey: text('task_key').notNull(), basisFingerprint: text('basis_fingerprint').notNull(),
  document: jsonDocument('document').$type<ExecutionValuationObservation>().notNull(),
});
export const executionValuationReceipts = observabilitySchema.table('execution_valuation_receipts', {
  taskKey: text('task_key').notNull(), requestKey: text('request_key').notNull(), fingerprint: text('fingerprint').notNull(),
  document: jsonDocument('document').$type<ExecutionValuationObservation>().notNull(),
}, (t) => [primaryKey({ columns: [t.taskKey, t.requestKey] })]);
