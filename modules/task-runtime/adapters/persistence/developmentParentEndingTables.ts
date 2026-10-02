import { bigint, boolean, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { DevelopmentParentEnding, DevelopmentParentEndingChild, DevelopmentParentEndingObject, DevelopmentParentRebuildClaim } from '../../ports/developmentParentEnding';
import { taskRuntimeSchema } from './schema';

export const developmentParentEndings = taskRuntimeSchema.table('development_parent_endings', {
  id: text('id').primaryKey(), parentId: text('parent_id').notNull(), projectId: text('project_id').notNull(),
  operation: text('operation').$type<DevelopmentParentEnding['operation']>().notNull(),
  epoch: jsonDocument('epoch').$type<DevelopmentParentEnding['epoch']>().notNull(), epochHash: text('epoch_hash').notNull(),
  selectionHash: text('selection_hash').notNull(), intent: jsonDocument('intent').$type<DevelopmentParentEnding['intent']>().notNull(),
  phase: text('phase').$type<DevelopmentParentEnding['phase']>().notNull(), status: text('status').$type<DevelopmentParentEnding['status']>().notNull(),
  membershipRevision: integer('membership_revision').notNull().default(1), memberCount: bigint('member_count', { mode: 'number' }).notNull().default(0),
  membershipFrozen: boolean('membership_frozen').notNull().default(false), afterChildId: text('after_child_id'),
  progress: jsonDocument('progress').$type<DevelopmentParentEnding['progress']>().notNull(),
  completionWitness: jsonDocument('completion_witness').$type<DevelopmentParentEnding['completionWitness']>(), message: text('message'),
  retryAt: timestamp('retry_at', { withTimezone: true }).notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
export const developmentParentEndingChildren = taskRuntimeSchema.table('development_parent_ending_children', {
  endingId: text('ending_id').notNull(), childId: text('child_id').notNull(), originalParentPodUid: text('original_parent_pod_uid'),
  snapshot: jsonDocument('snapshot').$type<DevelopmentParentEndingChild['snapshot']>().notNull(), closed: boolean('closed').notNull().default(false),
  closure: jsonDocument('closure').$type<DevelopmentParentEndingChild['closure']>(),
});
export const developmentParentEndingObjects = taskRuntimeSchema.table('development_parent_ending_objects', {
  endingId: text('ending_id').notNull(), kind: text('kind').$type<'Pod' | 'Secret'>().notNull(), namespace: text('namespace').notNull(), name: text('name').notNull(), uid: text('uid').notNull(),
  materialsHash: text('materials_hash').notNull(), absence: jsonDocument('absence').$type<DevelopmentParentEndingObject['absence']>(),
});
export const developmentParentRebuildClaims = taskRuntimeSchema.table('development_parent_rebuild_claims', {
  sourceEndingId: text('source_ending_id').primaryKey(), currentRebuildId: text('current_rebuild_id').notNull(), revision: bigint('revision', { mode: 'number' }).notNull(),
  afterTransitionHash: text('after_transition_hash').notNull(), state: text('state').$type<DevelopmentParentRebuildClaim['state']>().notNull(), retryAt: timestamp('retry_at', { withTimezone: true }).notNull(),
});
export const developmentParentRecoverySweep = taskRuntimeSchema.table('development_parent_recovery_sweep', {
  singleton: boolean('singleton').primaryKey().default(true), kind: text('kind').$type<'ending' | 'claim'>().notNull(),
  scanCutoff: timestamp('scan_cutoff', { withTimezone: true }).notNull(), afterId: text('after_id'), epoch: bigint('epoch', { mode: 'number' }).notNull().default(1),
});
