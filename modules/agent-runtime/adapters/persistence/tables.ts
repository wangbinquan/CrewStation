import { boolean, index, integer, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { jsonDocument } from '@crewstation/persistence';
import type { ComputeProfileContent, ProfileTestContext, ProfileTestStage } from '@crewstation/contracts';
import { agentRuntimeSchema } from './schema';

/** RFC-006：算力档位。说明、启用与默认在这里，执行内容在只追加的修订里；跨模块只存名称，不建外键。 */
export const profiles = agentRuntimeSchema.table('profiles', {
  name: text('name').primaryKey(),
  protocol: text('protocol').notNull(),
  description: text('description').notNull().default(''),
  enabled: boolean('enabled').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  currentRevision: integer('current_revision').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('profiles_single_default').on(t.isDefault).where(sql`${t.isDefault}`)]);

export const profileRevisions = agentRuntimeSchema.table('profile_revisions', {
  profile: text('profile').notNull(),
  revision: integer('revision').notNull(),
  content: jsonDocument('content').$type<ComputeProfileContent>().notNull(),
  imageDigest: text('image_digest').notNull(),
  contentHash: text('content_hash').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.profile, t.revision] })]);

export const profileCredentials = agentRuntimeSchema.table('profile_credentials', {
  profile: text('profile').notNull(),
  name: text('name').notNull(),
  cipherText: text('cipher_text').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.profile, t.name] })]);

export const profileTests = agentRuntimeSchema.table('profile_tests', {
  testId: text('test_id').primaryKey(),
  profile: text('profile').notNull(),
  revision: integer('revision').notNull(),
  contentHash: text('content_hash').notNull(),
  trigger: text('trigger').notNull(),
  clientRequestId: text('client_request_id'),
  createdBy: text('created_by').notNull(),
  state: text('state').notNull(),
  outcome: text('outcome'),
  context: jsonDocument('context').$type<ProfileTestContext>().notNull(),
  stages: jsonDocument('stages').$type<ProfileTestStage[]>().notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, (t) => [uniqueIndex('profile_tests_request').on(t.profile, t.createdBy, t.clientRequestId), index('profile_tests_revision').on(t.profile, t.revision, t.createdAt)]);
