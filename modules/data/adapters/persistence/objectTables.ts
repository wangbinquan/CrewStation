import { integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { jsonDocument } from '@crewstation/persistence';
import type { ArchivePlanRecord, FinalizationBinding, ObjectAttemptRecord, ObjectBackendRecord, ObjectMutation, ObjectPlanRecord, ObjectReadTransfer, ObjectReferenceRecord, ObjectSpaceRecord, ObjectUploadRecord, ObjectWriteControl, StoredObjectRecord, StorageFreeze } from '../../domain/objectStorage';
import type { ObjectProjectPolicy } from '../../ports/objectStorage';
import { dataSchema } from './schema';

export const objectBackends = dataSchema.table('object_backends', {
  id: text('id').primaryKey(), requestKey: text('request_key').notNull().unique(), body: jsonDocument('body').$type<ObjectBackendRecord>().notNull(),
});
export const objectPlans = dataSchema.table('object_plans', {
  id: text('id').primaryKey(), backendId: text('backend_id').notNull(), body: jsonDocument('body').$type<ObjectPlanRecord>().notNull(),
});
export const objectProjectPolicies = dataSchema.table('object_project_policies', {
  projectId: text('project_id').primaryKey(), body: jsonDocument('body').$type<ObjectProjectPolicy>().notNull(),
});
export const objectSpaces = dataSchema.table('object_spaces', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), serviceId: text('service_id').notNull(), env: text('env').notNull(),
  backendId: text('backend_id').notNull(), body: jsonDocument('body').$type<ObjectSpaceRecord>().notNull(),
}, (t) => [uniqueIndex('object_spaces_service_env').on(t.serviceId, t.env)]);
export const objectUploads = dataSchema.table('object_uploads', {
  id: text('id').primaryKey(), spaceId: text('space_id').notNull(), requestKey: text('request_key').notNull(), state: text('state').notNull(),
  body: jsonDocument('body').$type<ObjectUploadRecord>().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('object_uploads_space_request').on(t.spaceId, t.requestKey)]);
export const objectAttempts = dataSchema.table('object_upload_attempts', {
  id: text('id').primaryKey(), uploadId: text('upload_id').notNull(), spaceId: text('space_id').notNull(), backendId: text('backend_id').notNull(),
  state: text('state').notNull(), leaseUntil: timestamp('lease_until', { withTimezone: true }).notNull(),
  body: jsonDocument('body').$type<ObjectAttemptRecord>().notNull(),
});
export const storedObjects = dataSchema.table('objects', {
  id: text('id').primaryKey(), spaceId: text('space_id').notNull(), state: text('state').notNull(),
  body: jsonDocument('body').$type<StoredObjectRecord>().notNull(),
});
export const objectReferences = dataSchema.table('object_references', {
  objectId: text('object_id').notNull(), ownerType: text('owner_type').notNull(), ownerId: text('owner_id').notNull(), revision: integer('revision').notNull(),
  body: jsonDocument('body').$type<ObjectReferenceRecord>().notNull(),
}, (t) => [uniqueIndex('object_references_owner').on(t.objectId, t.ownerType, t.ownerId, t.revision)]);
export const objectWriteControls = dataSchema.table('object_write_control', {
  serviceId: text('service_id').primaryKey(), body: jsonDocument('body').$type<ObjectWriteControl>().notNull(),
});
export const objectMutations = dataSchema.table('object_mutations', {
  spaceId: text('space_id').notNull(), requestKey: text('request_key').notNull(), body: jsonDocument('body').$type<ObjectMutation>().notNull(),
}, (t) => [uniqueIndex('object_mutations_request').on(t.spaceId, t.requestKey)]);
export const objectReadTransfers = dataSchema.table('object_read_transfers', {
  id: text('id').primaryKey(), objectId: text('object_id').notNull(), spaceId: text('space_id').notNull(), backendId: text('backend_id').notNull(),
  body: jsonDocument('body').$type<ObjectReadTransfer>().notNull(),
});
export const objectStorageFreezes = dataSchema.table('object_storage_freezes', {
  id: text('id').primaryKey(), body: jsonDocument('body').$type<StorageFreeze>().notNull(),
});
export const archivePlans = dataSchema.table('archive_plans', {
  id: text('id').primaryKey(), taskId: text('task_id').notNull(), spaceId: text('space_id').notNull(), requestKey: text('request_key').notNull(),
  body: jsonDocument('body').$type<ArchivePlanRecord>().notNull(),
}, (t) => [uniqueIndex('archive_plans_task_request').on(t.taskId, t.requestKey)]);
export const finalizationBindings = dataSchema.table('finalization_bindings', {
  id: text('id').primaryKey(), taskId: text('task_id').notNull(), spaceId: text('space_id').notNull(),
  state: text('state').notNull(), body: jsonDocument('body').$type<FinalizationBinding>().notNull(),
}, (t) => [uniqueIndex('finalization_bindings_active_task').on(t.taskId).where(sql`${t.state} <> 'aborted'`)]);
