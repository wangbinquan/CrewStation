import { jsonDocument } from '@crewstation/persistence';
import { bigint, boolean, integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { DevelopmentImagePolicy, ImageBuild, ImageRevision, ImageValidation, ImageVersion, RuntimeImage, ImageReference } from '../../domain/records';
import { runtimeEnvironmentSchema as schema } from './schema';

export const runtimeImages = schema.table('images', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), name: text('name').notNull(), scope: text('scope').notNull(), enabled: boolean('enabled').notNull(),
  payload: jsonDocument('payload').$type<RuntimeImage>().notNull(),
});
export const imageRevisions = schema.table('revisions', {
  id: text('id').primaryKey(), imageId: text('image_id').notNull(), revision: integer('revision').notNull(), payload: jsonDocument('payload').$type<ImageRevision>().notNull(),
}, (t) => [uniqueIndex('image_revision_unique').on(t.imageId, t.revision)]);
export const imageBuilds = schema.table('builds', {
  id: text('id').primaryKey(), imageId: text('image_id').notNull(), projectId: text('project_id').notNull(), actorId: text('actor_id').notNull(), requestKey: text('request_key').notNull(),
  state: text('state').notNull(), leaseUntil: timestamp('lease_until', { withTimezone: true }), payload: jsonDocument('payload').$type<ImageBuild>().notNull(),
}, (t) => [uniqueIndex('image_build_request_unique').on(t.imageId, t.actorId, t.requestKey)]);
export const imageVersions = schema.table('versions', {
  id: text('id').primaryKey(), imageId: text('image_id').notNull(), projectId: text('project_id').notNull(), buildId: text('build_id').notNull(),
  repository: text('repository').notNull(), digest: text('digest').notNull(), state: text('state').notNull(), payload: jsonDocument('payload').$type<ImageVersion>().notNull(),
}, (t) => [uniqueIndex('image_version_build_unique').on(t.buildId)]);
export const imageValidations = schema.table('validations', {
  id: text('id').primaryKey(), versionId: text('version_id').notNull(), actorId: text('actor_id').notNull(), requestKey: text('request_key').notNull(), contractDigest: text('contract_digest').notNull(),
  state: text('state').notNull(), leaseUntil: timestamp('lease_until', { withTimezone: true }), payload: jsonDocument('payload').$type<ImageValidation>().notNull(),
}, (t) => [uniqueIndex('image_validation_request_unique').on(t.versionId, t.actorId, t.requestKey)]);
export const imageReferences = schema.table('references', {
  id: text('id').primaryKey(), versionId: text('version_id').notNull(), projectId: text('project_id').notNull(), ownerType: text('owner_type').notNull(), ownerId: text('owner_id').notNull(),
  payload: jsonDocument('payload').$type<ImageReference>().notNull(),
}, (t) => [uniqueIndex('image_reference_owner_unique').on(t.versionId, t.ownerType, t.ownerId)]);
export const imageLogs = schema.table('build_logs', {
  sequence: bigint('sequence', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(), buildId: text('build_id').notNull(), stage: text('stage').notNull(), text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export const developmentImagePolicies = schema.table('development_policies', { projectId: text('project_id').primaryKey(), payload: jsonDocument('payload').$type<DevelopmentImagePolicy>().notNull() });
