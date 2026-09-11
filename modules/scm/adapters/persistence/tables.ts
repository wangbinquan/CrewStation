import { text, timestamp } from 'drizzle-orm/pg-core';
import { scmSchema } from './schema';

export const repositoryBindings = scmSchema.table('repository_bindings', {
  serviceId: text('service_id').primaryKey(),
  projectId: text('project_id').notNull(),
  provider: text('provider').notNull(),
  remoteProjectId: text('remote_project_id').notNull(),
  pathWithNamespace: text('path_with_namespace').notNull().unique(),
  httpUrl: text('http_url').notNull(),
  defaultBranch: text('default_branch').notNull(),
  state: text('state').notNull(),
  message: text('message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** 只存令牌哈希与远端令牌 ID，绝不存明文。 */
export const sessionCredentials = scmSchema.table('session_credentials', {
  id: text('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  remoteTokenId: text('remote_token_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
